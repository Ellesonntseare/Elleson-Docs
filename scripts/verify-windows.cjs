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
    await window.getByRole("textbox", { name: "Name", exact: true }).fill("Saved back to original")
    await window.getByRole("textbox", { name: "Name", exact: true }).blur()
    await window.getByText("Change synced", { exact: true }).waitFor()
    if (!(await window.locator("#save-original").isVisible())) await window.locator("#more-actions").click()
    await window.getByRole("button", { name: "Save", exact: true }).click()
    await window.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Saved to "))
    assert.equal((await PDFDocument.load(await fs.readFile(exported))).getForm().getTextField("Name").getText(), "Saved back to original")
    const changed = await PDFDocument.load(await fs.readFile(exported))
    changed.getForm().getTextField("Name").setText("Changed in another application")
    await fs.writeFile(exported, await changed.save())
    await window.getByRole("textbox", { name: "Name", exact: true }).fill("Keep this edit unsaved")
    await window.getByRole("textbox", { name: "Name", exact: true }).blur()
    await window.getByText("Change synced", { exact: true }).waitFor()
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }) })
    await window.getByRole("button", { name: "Save", exact: true }).click()
    await window.getByText("Save cancelled", { exact: true }).waitFor()
    assert.equal((await PDFDocument.load(await fs.readFile(exported))).getForm().getTextField("Name").getText(), "Changed in another application")
    if (process.env.ELLESON_DOCS_OUTPUTS) {
      await window.screenshot({ path: path.join(process.env.ELLESON_DOCS_OUTPUTS, "Elleson-Docs-Windows.png") })
    }
    console.log("Windows executable opened, edited, saved and reopened a PDF; normal Save updated its file and protected an external change when cancelled.")
  } finally {
    await application.close()
  }
}
verify().catch(error => { console.error(error); process.exitCode = 1 })
