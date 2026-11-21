const { test } = require("node:test")
const assert = require("node:assert/strict")
const { start } = require("../server.cjs")
const { chromium } = require("playwright")
const { PDFDocument } = require("pdf-lib")
const fs = require("node:fs/promises")
const path = require("node:path")

test("form suggestions, autofill, library filters, and invitation work through the local browser UI", { timeout: 60000 }, async () => {
  const host = await start()
  const browser = await chromium.launch({ channel: "msedge" })
  try {
    const pdf = await PDFDocument.create(), sheet = pdf.addPage([420, 550])
    sheet.drawText("Full name: ___________", { x: 32, y: 410, size: 14 })
    sheet.drawText("Application for vendor screening", { x: 32, y: 500, size: 14 })
    await host.open("vendor.pdf", Buffer.from(await pdf.save()))
    const screen = await browser.newPage(), errors = []
    screen.setDefaultTimeout(7500)
    screen.on("pageerror", error => errors.push(error.message))
    await screen.goto(host.address + "/#owner=" + host.owner)
    await screen.getByText("PDF ready", { exact: true }).waitFor()
    const click = (page, selector) => page.locator(selector).evaluate(button => button.click())
    await click(screen, "#suite-forms")
    const forms = screen.locator("#form-workspace")
    await forms.getByRole("button", { name: "Suggest fields from this page" }).click()
    await forms.getByText(/Full name · page 1/).waitFor()
    await forms.getByRole("button", { name: "Apply selected fields" }).click()
    await forms.getByText(/1 fields/).waitFor()
    await screen.evaluate(() => localStorage.setItem("elleson-profile", JSON.stringify({ Name: "Test Customer" })))
    await forms.getByRole("button", { name: "Preview profile autofill" }).click()
    await forms.getByText(/Full name → Test Customer/).waitFor()
    await forms.getByRole("button", { name: "Apply selected fields" }).click()
    await forms.getByText(/1 fields/).waitFor()
    await forms.getByRole("button", { name: "Close" }).click()
    assert.equal(await screen.locator('#pdf-fields [data-field="Full name"]').inputValue(), "Test Customer")

    await click(screen, "#library")
    const files = screen.locator("#library-dialog")
    await files.getByRole("button", { name: "Edit tags" }).click()
    await screen.getByLabel("Comma-separated tags").fill("Vendors")
    await screen.getByRole("button", { name: "Save tags" }).click()
    await files.getByText(/saved version\(s\) · Vendors/).waitFor()
    await files.getByLabel("Search saved files").fill("vendor screening")
    await files.getByRole("button", { name: "Search", exact: true }).click()
    await files.getByText(/Vendors.*Page 1.*vendor screening/i).waitFor().catch(async error => {
      throw new Error(await files.innerText() + "\n" + await screen.locator("#status").innerText(), { cause: error })
    })
    await files.getByRole("button", { name: "Close", exact: true }).click()

    await click(screen, "#suite-collaboration")
    const share = screen.locator("#collaboration-workspace")
    await share.getByRole("button", { name: "Create invite link" }).click()
    const link = new URL(await share.getByLabel("One-use invitation link").first().inputValue())
    const guest = await browser.newPage({ viewport: { width: 390, height: 780 } })
    guest.setDefaultTimeout(7500)
    guest.on("pageerror", error => errors.push(error.message))
    await guest.goto(host.address + "/" + link.hash)
    await guest.getByLabel("Display name").fill("Browser reviewer")
    await guest.getByRole("button", { name: "Join document" }).click()
    const guestField = guest.locator('#pdf-fields [data-field="Full name"]')
    await guestField.waitFor()
    await guestField.fill("Guest updated value")
    await guestField.blur()
    await share.getByText(/Browser reviewer.*Online/).waitFor()
    await share.getByText("Recent edits").click()
    await share.getByText(/Browser reviewer · field/).waitFor()
    await share.getByRole("button", { name: "Close", exact: true }).click()
    await screen.waitForFunction(() => document.querySelector('#pdf-fields [data-field="Full name"]')?.value === "Guest updated value")

    const raster = await screen.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 800
      canvas.height = 1000
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "white"
      ctx.fillRect(0, 0, 800, 1000)
      ctx.fillStyle = "black"
      ctx.font = "36px Arial"
      ctx.fillText("Registration details", 60, 90)
      ctx.fillText("Full name: ____________", 60, 190)
      return canvas.toDataURL().split(",")[1]
    })
    const paper = await PDFDocument.create()
    paper.addPage([400, 500]).drawImage(await paper.embedPng(Buffer.from(raster, "base64")), { x: 0, y: 0, width: 400, height: 500 })
    await host.open("Paper form.pdf", Buffer.from(await paper.save()))
    await screen.locator("#file-title").getByText("Paper form.pdf", { exact: true }).waitFor()
    await screen.getByText("PDF ready", { exact: true }).waitFor()
    await click(screen, "#suite-forms")
    await forms.getByRole("button", { name: "Suggest fields from this page" }).click()
    await forms.getByText(/Full name · page 1/i).waitFor({ timeout: 12000 }).catch(async error => {
      throw new Error(await forms.innerText(), { cause: error })
    })
    await forms.getByRole("button", { name: "Apply selected fields" }).click()
    await forms.getByText(/1 fields/).waitFor()
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
    await new Promise(resolve => {
      host.server.close(resolve)
      host.server.closeAllConnections()
    })
  }
})

test("standalone Android browser assets run forms, privacy copies and library search locally", { timeout: 70000 }, async () => {
  const browser = await chromium.launch({ channel: "msedge" })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const assets = path.resolve(__dirname, "../.build/android-assets/app")
    const errors = []
    await context.route("**/*", async route => {
      const { hostname, pathname } = new URL(route.request().url())
      const filename = path.resolve(assets, pathname === "/" ? "index.html" : pathname.slice(1))
      if (hostname !== "appassets.androidplatform.net" || pathname.startsWith("/api/") || !filename.startsWith(assets + path.sep)) return route.abort()
      const extension = path.extname(filename)
      const contentType = { ".mjs": "application/javascript", ".js": "application/javascript", ".wasm": "application/wasm", ".css": "text/css", ".png": "image/png", ".html": "text/html" }[extension] || "application/octet-stream"
      try { await route.fulfill({ body: await fs.readFile(filename), contentType }) }
      catch { await route.fulfill({ status: 404, body: "Missing asset" }) }
    })
    const page = await context.newPage()
    page.on("pageerror", error => errors.push(error.message))
    await page.goto("https://appassets.androidplatform.net/#owner=local")
    await page.getByRole("heading", { name: "Open a document" }).waitFor({ timeout: 10000 })
    const pdf = await PDFDocument.create()
    pdf.setAuthor("Private metadata")
    pdf.addPage([420, 550]).drawText("Offline archive searchable content")
    await page.locator("#file").setInputFiles({ name: "offline-feature.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) })
    await page.getByText("PDF ready", { exact: true }).waitFor({ timeout: 10000 }).catch(async error => {
      throw new Error(await page.locator("#status").textContent() + " / " + errors.join(", "), { cause: error })
    })
    const result = await page.evaluate(async () => {
      const get = async url => {
        const response = await fetch(url)
        if (!response.ok) throw Error(await response.text())
        return response.json()
      }
      const post = async (url, body) => {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        if (!response.ok) throw Error(await response.text())
        return response
      }
      const { document: doc } = await get("/api/state")
      await post("/api/library/" + doc.libraryId + "/tags", { tags: ["Offline"] })
      const { matches } = await get("/api/library-search?q=searchable%20content")
      await post("/api/edit/" + doc.id, { id: "offline-form-01", kind: "form-author", version: doc.contentVersion,
        changes: [{ action: "create", name: "Local answer", type: "text", required: true, page: 1, x: 30, y: 280, width: 150, height: 25 }] })
      const fields = await get("/api/form-fields/" + doc.id)
      const clean = await post("/api/pdf-copy/" + doc.id, { action: "clean", categories: ["metadata"] })
      return { page: matches[0].page, field: fields[0].name, clean: JSON.parse(clean.headers.get("X-Result-Report")).after.metadata }
    })
    assert.deepEqual(result, { page: 1, field: "Local answer", clean: 0 })
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
