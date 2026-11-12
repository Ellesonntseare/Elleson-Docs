const { test } = require("node:test")
const assert = require("node:assert/strict")
const { chromium } = require("playwright")
const { PDFDocument } = require("pdf-lib")
const { Document, Paragraph, Packer } = require("docx")
const { readWord } = require("../word.cjs")
const { start } = require("../server.cjs")

test("paired editors exchange real PDF and DOCX changes and export from either client", { timeout: 90000 }, async t => {
  const host = await start()
  t.after(() => host.server.close())
  const browser = await chromium.launch({ channel: "msedge" })
  t.after(() => browser.close())
  const pc = await browser.newPage({ viewport: { width: 1100, height: 780 } })
  const phone = await browser.newPage({ viewport: { width: 390, height: 770 }, isMobile: true, hasTouch: true })
  const failures = []
  for (const screen of [pc, phone]) {
    screen.setDefaultTimeout(12000)
    screen.on("pageerror", error => failures.push(error.message))
  }

  const pdf = await PDFDocument.create()
  const first = pdf.addPage([500, 680])
  first.drawText("Elleson Docs verification", { x: 35, y: 620 })
  pdf.getForm().createTextField("Reviewer").addToPage(first, { x: 60, y: 540, width: 200, height: 24 })
  pdf.addPage([500, 680]).drawText("Second page", { x: 35, y: 620 })
  await host.open("review.pdf", Buffer.from(await pdf.save()))

  await pc.goto(host.address + "/#owner=" + host.owner)
  await pc.getByText("PDF ready", { exact: true }).waitFor().catch(async error => {
    throw new Error((await pc.locator("#status").textContent()) + " / " + failures.join(", "), { cause: error })
  })
  await pc.getByRole("button", { name: "Connect phone" }).click()
  const address = await pc.locator("#addresses code").first().textContent()
  const code = await pc.locator("#pair-code").textContent()
  await phone.goto(address)
  await phone.getByLabel("Pairing code").fill(code)
  await phone.getByRole("button", { name: "Connect", exact: true }).click()
  await phone.getByText("PDF ready", { exact: true }).waitFor()
  await pc.getByRole("button", { name: "Done" }).click()
  await pc.getByText("Phone and PC connected").waitFor()

  const pcField = pc.getByRole("textbox", { name: "Reviewer" })
  const phoneField = phone.getByRole("textbox", { name: "Reviewer" })
  await pcField.fill("Edited on the PC")
  await phone.waitForFunction(() => document.querySelector('[aria-label="Reviewer"]').value === "Edited on the PC")
  await pcField.blur()
  await phoneField.fill("Edited on the phone")
  await phoneField.blur()
  await pc.waitForFunction(() => document.querySelector('[aria-label="Reviewer"]').value === "Edited on the phone")

  await pc.getByRole("button", { name: "Add text", exact: true }).click()
  await pc.locator("#ink-canvas").click({ position: { x: 80, y: 135 } })
  await pc.getByLabel("Text", { exact: true }).fill("PC annotation")
  await pc.getByRole("dialog").getByRole("button", { name: "Add text" }).click()
  await pc.getByText("Change synced").waitFor()
  await phone.getByRole("button", { name: "Undo mark" }).isEnabled().then(async enabled => {
    if (!enabled) await phone.locator("#undo:enabled").waitFor()
  })
  await phone.getByRole("button", { name: "Draw" }).click()
  const bounds = await phone.locator("#ink-canvas").boundingBox()
  await phone.mouse.move(bounds.x + 35, bounds.y + 195)
  await phone.mouse.down()
  await phone.mouse.move(bounds.x + 120, bounds.y + 223, { steps: 8 })
  await pc.waitForFunction(async token => {
    const result = await (await fetch("/api/state", { headers: { Authorization: "Bearer " + token } })).json()
    return result.preview?.points.length > 1
  }, host.owner)
  await phone.mouse.up()
  await phone.getByText("Change synced").waitFor()
  await pc.getByRole("button", { name: "Page 2", exact: true }).click()
  assert.equal(await pc.getByLabel("Page number").inputValue(), "2")
  assert.equal(await phone.getByLabel("Page number").inputValue(), "1")

  const documentId = await pc.evaluate(async token => {
    const response = await fetch("/api/state", { headers: { Authorization: "Bearer " + token } })
    const state = await response.json()
    if (state.document.marks.map(mark => mark.kind).join() !== "text,ink") throw Error("Both marks must reach the shared document.")
    return state.document.id
  }, host.owner)
  for (const client of [pc, phone]) {
    const downloadPromise = client.waitForEvent("download")
    await client.getByRole("button", { name: "Save copy" }).click()
    const download = await downloadPromise
    const reopened = await PDFDocument.load(await require("node:fs/promises").readFile(await download.path()))
    assert.equal(reopened.getForm().getTextField("Reviewer").getText(), "Edited on the phone")
    assert.equal(reopened.getPageCount(), 2)
  }
  assert.equal((await host.exportFile(documentId)).filename, "review - copy.pdf")
  await pc.getByRole("button", { name: "Page 1", exact: true }).click()
  await pc.getByRole("button", { name: "Edit PDF", exact: true }).click()
  await pc.getByRole("button", { name: "Edit Elleson Docs verification", exact: true }).click()
  await pc.getByLabel("Replacement text").fill("Elleson Docs checked")
  await pc.getByRole("button", { name: "Apply edit" }).click()
  await phone.locator("#selection-layer").getByText("Elleson Docs checked", { exact: true }).waitFor()
  await phone.getByRole("button", { name: "Edit PDF", exact: true }).click()
  await phone.getByRole("button", { name: "Edit Elleson Docs checked", exact: true }).click()
  await phone.getByLabel("Replacement text").fill("Elleson Docs phone edit")
  await phone.getByRole("button", { name: "Apply edit" }).click()
  await pc.locator("#selection-layer").getByText("Elleson Docs phone edit", { exact: true }).waitFor()
  assert.equal(await pc.locator("#pages button").count(), 2)
  if (process.env.ELLESON_DOCS_OUTPUTS) {
    const path = require("node:path")
    await pc.getByRole("button", { name: "View", exact: true }).click()
    await phone.getByRole("button", { name: "View", exact: true }).click()
    await pc.screenshot({ path: path.join(process.env.ELLESON_DOCS_OUTPUTS, "Elleson-Docs-PC.png") })
    await phone.screenshot({ path: path.join(process.env.ELLESON_DOCS_OUTPUTS, "Elleson-Docs-Phone.png") })
  }

  const scanned = await PDFDocument.create()
  const scanPage = scanned.addPage([400, 560])
  const bitmap = await scanned.embedPng(await require("node:fs/promises").readFile(require("node:path").join(__dirname, "../web/logo.png")))
  scanPage.drawImage(bitmap, { x: 20, y: 200, width: 250, height: 250 })
  await host.open("scan.pdf", Buffer.from(await scanned.save()))
  for (const client of [pc, phone]) {
    await client.getByText("scan.pdf", { exact: true }).waitFor()
    await client.getByText("PDF ready", { exact: true }).waitFor()
    assert.equal(await client.locator("#pdf-canvas").evaluate(canvas => canvas.width > 100), true)
  }

  const word = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("First paragraph"), new Paragraph("Second paragraph")] }] }))
  await phone.locator("#file").setInputFiles({ name: "review.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: word })
  await pc.getByText("First paragraph", { exact: true }).waitFor()
  await pc.getByRole("button", { name: "Edit text" }).click()
  const desktopParagraph = pc.locator('#word-sheet p[contenteditable="plaintext-only"]').first()
  await desktopParagraph.fill("Word text from the PC")
  await phone.getByText("Word text from the PC", { exact: true }).waitFor()
  await desktopParagraph.blur()
  await phone.getByRole("button", { name: "Edit text" }).click()
  const phoneParagraph = phone.locator('#word-sheet p[contenteditable="plaintext-only"]').nth(1)
  await phoneParagraph.fill("Word text from the phone")
  await phoneParagraph.blur()
  await pc.getByText("Word text from the phone", { exact: true }).waitFor()
  for (const client of [pc, phone]) {
    const downloadPromise = client.waitForEvent("download")
    await client.getByRole("button", { name: "Save copy" }).click()
    const download = await downloadPromise
    const reopened = await readWord(await require("node:fs/promises").readFile(await download.path()), "docx")
    assert.deepEqual(reopened.lines.map(line => line.text), ["Word text from the PC", "Word text from the phone"])
  }
  assert.deepEqual(failures, [])
})
