const { _electron } = require("playwright")
const { PDFDocument } = require("pdf-lib")
const fs = require("node:fs/promises")
const path = require("node:path")
const assert = require("node:assert/strict")

async function verify() {
  const executablePath = path.resolve(process.argv[2])
  const scratch = await fs.mkdtemp(path.join(__dirname, "../.build/windows-check-"))
  const fixture = path.join(scratch, "desktop-test.pdf")
  const exported = path.join(scratch, "saved.pdf")
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([400, 500])
  page.drawText("Windows application check", { x: 30, y: 450, size: 18 })
  pdf.getForm().createTextField("Name").addToPage(page, { x: 40, y: 360, width: 200, height: 24 })
  await fs.writeFile(fixture, await pdf.save())
  const application = await _electron.launch({
    executablePath, args: [fixture], timeout: 45000,
    env: { ...process.env, ELLESON_DOCS_USER_DATA: scratch, ELLESON_DOCS_TEST: "1" }
  })
  try {
    const window = await application.firstWindow()
    await window.getByText("PDF ready", { exact: true }).waitFor({ timeout: 45000 })
    const field = window.getByRole("textbox", { name: "Name", exact: true })
    await field.fill("Native Windows save")
    await field.blur()
    await window.getByText("Change synced", { exact: true }).waitFor()
    await application.evaluate(({ dialog }, savedPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedPath })
    }, exported)
    await window.getByRole("button", { name: "Save copy" }).click()
    await window.getByText("Copy saved", { exact: true }).waitFor()
    const reopened = await PDFDocument.load(await fs.readFile(exported))
    assert.equal(reopened.getForm().getTextField("Name").getText(), "Native Windows save")
    await application.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
    }, exported)
    await window.getByRole("button", { name: "Open file", exact: true }).click()
    await window.locator("#file-title").getByText("saved.pdf", { exact: true }).waitFor()
    await window.getByText("PDF ready", { exact: true }).waitFor()
    assert.equal(await window.getByRole("textbox", { name: "Name", exact: true }).inputValue(), "Native Windows save")
    if (process.env.ELLESON_DOCS_OUTPUTS) {
      await window.screenshot({ path: path.join(process.env.ELLESON_DOCS_OUTPUTS, "Elleson-Docs-Windows.png") })
    }
    console.log("Windows executable opened a PDF from its launch argument, edited it, saved through desktop IPC and reopened the result.")
  } finally {
    await application.close()
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
