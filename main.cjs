const { app, BrowserWindow, dialog, ipcMain } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const { start } = require("./server.cjs")
if (process.env.ELLESON_DOCS_USER_DATA) app.setPath("userData", process.env.ELLESON_DOCS_USER_DATA)

let window
let host
let pending = process.argv.find(value => /\.(pdf|docx?)$/i.test(value))

async function openDocument(filename, confirmed = false) {
  if (!filename || !host) return
  try {
    const current = host.getDocument()
    if (!confirmed && current?.dirty) {
      const decision = await dialog.showMessageBox(window, { type: "question", buttons: ["Cancel", "Replace document"],
        defaultId: 0, cancelId: 0, title: "Unsaved changes", message: "Replace " + current.filename + "?",
        detail: "Choose Cancel to save a copy before opening the new document." })
      if (decision.response !== 1) return
    }
    if ((await fs.stat(filename)).size > host.maxBytes) throw new Error("Choose a file smaller than 40 MB.")
    await host.open(path.basename(filename), await fs.readFile(filename))
  } catch (error) {
    dialog.showErrorBox("Could not open document", error.message)
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", (_, args) => {
    const filename = args.find(value => /\.(pdf|docx?)$/i.test(value))
    if (host) void openDocument(filename)
    else if (filename) pending = filename
    if (window?.isMinimized()) window.restore()
    window?.focus()
  })
  app.whenReady().then(async () => {
    host = await start(0, path.join(app.getPath("userData"), "recovery"))
    window = new BrowserWindow({
      title: "Elleson Docs", width: 1220, height: 870, minWidth: 460, minHeight: 420,
      autoHideMenuBar: true, backgroundColor: "#eef1ed",
      show: process.env.ELLESON_DOCS_TEST !== "1",
      icon: path.join(__dirname, "web", "logo.png"),
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    window.webContents.on("will-navigate", event => event.preventDefault())
    ipcMain.handle("pick-document", async event => {
      if (event.sender !== window.webContents) return
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [{ name: "PDF and Word documents", extensions: ["pdf", "doc", "docx"] }]
      })
      await openDocument(selection.filePaths[0], true)
    })
    ipcMain.handle("save-document", async (event, id, options) => {
      if (event.sender !== window.webContents) return false
      const exported = await host.exportFile(id, { flatten: options?.flatten === true })
      const { filename, bytes, changeNumber } = exported
      const result = await dialog.showSaveDialog(window, { defaultPath: filename })
      if (result.canceled) return false
      await fs.writeFile(result.filePath, bytes)
      await host.markSaved(id, changeNumber, exported)
      return true
    })
    await window.loadURL(host.address + "/#owner=" + host.owner)
    await openDocument(pending)
  }).catch(error => {
    dialog.showErrorBox("Elleson Docs", error.message)
    app.quit()
  })
  app.on("window-all-closed", () => app.quit())
}
