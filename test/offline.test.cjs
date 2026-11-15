const { clickTool } = require('./menu-helper.cjs')
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")
const { chromium } = require("playwright")
const { PDFDocument } = require("pdf-lib")
const { Document, Paragraph, TextRun, Packer } = require("docx")
const { readWord } = require("../word.cjs")

test("bundled standalone phone assets open, edit, save and recover without a PC", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: "msedge" })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const assets = path.resolve(__dirname, "../.build/android-assets/app")
    const unexpected = []
    await context.route("**/*", async route => {
      const url = new URL(route.request().url())
      if (url.hostname !== "appassets.androidplatform.net" || url.pathname.startsWith("/api/")) {
        unexpected.push(url.href)
        return route.abort()
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1)
      const filename = path.resolve(assets, relative)
      if (!filename.startsWith(assets + path.sep)) return route.abort()
      const contentType = /\.(mjs|js)$/.test(filename) ? "application/javascript"
        : filename.endsWith(".wasm") ? "application/wasm"
        : filename.endsWith(".css") ? "text/css" : filename.endsWith(".png") ? "image/png" : "text/html"
      try { await route.fulfill({ body: await fs.readFile(filename), contentType }) }
      catch { await route.fulfill({ status: 404, body: "Missing asset" }) }
    })
    const screen = await context.newPage()
    const errors = []
    screen.on("pageerror", error => errors.push(error.message))
    if (process.env.DEBUG_OCR) { screen.on('console',message=>console.log('BROWSER',message.type(),message.text())); screen.on('requestfailed',request=>console.log('FAILED',request.url(),request.failure())); }
    await screen.goto("https://appassets.androidplatform.net/#owner=local")
    await screen.getByRole("heading", { name: "Open a document" }).waitFor()
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([400, 500])
    page.drawText("Offline document", { x: 40, y: 440, size: 18 })
    pdf.getForm().createTextField("Answer").addToPage(page, { x: 40, y: 350, width: 220, height: 25 })
    await screen.locator("#file").setInputFiles({ name: "offline.pdf", mimeType: "application/pdf", buffer: Buffer.from(await pdf.save()) })
    await screen.getByText("PDF ready", { exact: true }).waitFor({ timeout: 10000 }).catch(async error => {
      throw new Error(await screen.locator("#status").textContent() + " / " + JSON.stringify({ errors, unexpected }), { cause: error })
    })
    await screen.getByRole("textbox", { name: "Answer" }).fill("Written on phone")
    await screen.getByRole("textbox", { name: "Answer" }).blur()
    await screen.getByText("Change synced", { exact: true }).waitFor()
    const downloadPromise = screen.waitForEvent("download")
    await clickTool(screen, screen.getByRole("button", { includeHidden: true, name: "Save copy" }))
    const download = await downloadPromise
    assert.equal((await PDFDocument.load(await fs.readFile(await download.path()))).getForm().getTextField("Answer").getText(), "Written on phone")
    await screen.reload()
    await screen.getByText("PDF ready", { exact: true }).waitFor()
    assert.equal(await screen.getByRole("textbox", { name: "Answer" }).inputValue(), "Written on phone")
    await clickTool(screen, screen.locator("summary").filter({hasText:/^More$/}))
    await clickTool(screen, screen.getByRole("button", { includeHidden: true, name: "Files", exact: true }))
    await clickTool(screen, screen.getByRole("button", { includeHidden: true, name: "Versions", exact: true }))
    await screen.locator("#versions-dialog[open] #versions-list button[data-version-open]").first().waitFor()
    assert.equal(await screen.locator("#versions-list button[data-version-open]").count(), 2)
    await clickTool(screen, screen.locator("#versions-list button[data-version-open]").last())
    await screen.waitForFunction(() => document.querySelector('[aria-label="Answer"]')?.value === "")
    assert.equal(await screen.getByRole("textbox", { name: "Answer" }).inputValue(), "")
    await clickTool(screen, screen.locator("summary").filter({hasText:/^More$/}))
    await clickTool(screen, screen.getByRole("button", { includeHidden: true, name: "Bookmarks", exact: true }))
    await clickTool(screen, screen.getByRole("button", { includeHidden: true, name: "Bookmark this page" }))
    await screen.locator("#bookmark-list").getByRole("button", { includeHidden: true, name: "Page 1", exact: true }).waitFor()
    await clickTool(screen, screen.locator("#bookmark-list").getByRole("button", { includeHidden: true, name: "Page 1", exact: true }))
    const replacement = await screen.evaluate(async () => {
      const state = await (await fetch("/api/state")).json()
      const id = state.document.id
      const text = await (await fetch("/api/text/" + id + "/1")).json()
      const span = text.spans.find(span => span.text === "Offline document")
      const result = await fetch("/api/edit/" + id, { method: "POST", body: JSON.stringify({
        id: crypto.randomUUID(), kind: "replace", version: text.version, page: 1, span: span.id, before: span.text, value: "Phone document"
      }) })
      return { status: result.status, result: await result.json() }
    })
    assert.equal(replacement.status, 200, JSON.stringify(replacement))
    const document = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [
      new TextRun({ text: "Bold ", bold: true }), new TextRun("paragraph")
    ] })] }] }))
    screen.once("dialog", dialog => dialog.accept())
    await screen.evaluate(data => window.dispatchEvent(new CustomEvent("elleson-open-file", {
      detail: { name: "offline.docx", data }
    })), document.toString("base64"))
    await screen.locator("#file-title").getByText("offline.docx", { exact: true }).waitFor()
    const savedWord = await screen.evaluate(async () => {
      const { document } = await (await fetch("/api/state")).json()
      const edit = async change => {
        const result = await fetch("/api/edit/" + document.id, { method: "POST", body: JSON.stringify({ id: crypto.randomUUID(), ...change }) })
        if (!result.ok) throw new Error(await result.text())
        return result.json()
      }
      let result = await edit({ kind: "word", index: 0, before: "Bold paragraph", value: "Bold changed paragraph" })
      result = await edit({ kind: "word-format", index: 0, version: result.contentVersion, format: { font: "Georgia", size: 18, italic: true, list: "bullet" } })
      await edit({ kind: "word-table", index: 0, version: result.contentVersion, rows: 2, columns: 2 })
      const bytes = new Uint8Array(await (await fetch("/api/source/" + document.id)).arrayBuffer())
      return Array.from(bytes)
    })
    const word = await readWord(Buffer.from(savedWord), "docx")
    assert.equal(word.lines[0].text, "Bold changed paragraph")
    const wordNamespace = word.document.documentElement.namespaceURI
    assert.equal(word.document.getElementsByTagNameNS(wordNamespace, "tbl").length, 1)
    assert.ok(word.archive["word/numbering.xml"])
    assert.equal(word.document.getElementsByTagNameNS(wordNamespace, "r")[0].getElementsByTagNameNS(wordNamespace, "t")[0].textContent, "Bold ")
    const photo = await screen.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 1000
      canvas.height = 500
      const context = canvas.getContext("2d")
      context.fillStyle = "white"
      context.fillRect(0, 0, 1000, 500)
      context.fillStyle = "black"
      context.font = "54px Arial"
      context.fillText("SCANNED DOCUMENT", 70, 160)
      return canvas.toDataURL("image/png").split(",")[1]
    })
    screen.on("dialog", dialog => dialog.accept())
    await screen.locator("#scan-file").setInputFiles({ name: "camera.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") })
    await screen.locator("#scan-dialog[open]").waitFor()
    await screen.locator("#scan-file").setInputFiles({ name: "camera-second.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") })
    await screen.getByRole("button", { includeHidden: true, name: "Page 2", exact: true }).waitFor()
    await screen.getByLabel("Image mode", { exact: true }).selectOption("receipt")
    await screen.waitForFunction(() => document.querySelector('#scan-preview').getAttribute('aria-busy') === 'false')
    await screen.locator("#scan-preview").evaluate(image => image.decode())
    await screen.screenshot({ path: path.resolve(__dirname, "../.build/offline-scan.png") })
    assert.equal(await screen.evaluate(() => document.body.scrollWidth), 390)
    await clickTool(screen, screen.locator("#scan-create"))
    await screen.locator("#file-title").getByText("camera.pdf", { exact: true }).waitFor()
    assert.equal(await screen.evaluate(async () => (await (await fetch("/api/state")).json()).document.pages), 2)
    const perspective = await screen.evaluate(async data => {
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0)), file = new File([bytes], "perspective.png", { type: "image/png" })
      const engine = await import("/scan-runtime.mjs"), corners = await engine.detectCorners(file)
      const processed = await engine.prepareImage(file, { corners: [[.1, .1], [.9, .05], [.8, .9], [.1, .8]], filter: "document" })
      const image = await createImageBitmap(processed)
      const result = { width: image.width, height: image.height, corners }; image.close(); return result
    }, photo)
    assert.equal(perspective.corners.length, 4); assert.ok(perspective.width < 1000 && perspective.height < 500)
    const recognized = await screen.evaluate(async () => {
      const { document } = await (await fetch("/api/state")).json()
      const result = await fetch("/api/ocr/" + document.id + "/1", { method: "POST", body: JSON.stringify({ lang: "eng" }) })
      const text = await result.text()
      if (!result.ok) throw new Error(text)
      const spans = await (await fetch("/api/text/" + document.id + "/1")).json()
      return spans.spans.map(span => span.text).join(" ")
    })
    assert.match(recognized, /SCANNED DOCUMENT/i)
    await screen.locator('#file').setInputFiles({name:'Gallery.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')})
    await screen.locator('#file-title').getByText('Gallery.pdf',{exact:true}).waitFor()
    const exportPicture=screen.waitForEvent('download')
    await clickTool(screen,screen.getByRole('button',{name:'Save as PDF',exact:true,includeHidden:true}))
    const picturePdf=await exportPicture
    const converted=await PDFDocument.load(await fs.readFile(await picturePdf.path()))
    assert.equal(converted.getPageCount(),1)
    assert.ok(converted.getPage(0).getWidth()>converted.getPage(0).getHeight(),'landscape photo keeps its aspect ratio')
    assert.deepEqual(unexpected, [])
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})
