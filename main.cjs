const { app, BrowserWindow, dialog, ipcMain } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const { start } = require("./server.cjs")
if (process.env.ELLESON_DOCS_USER_DATA) app.setPath("userData", process.env.ELLESON_DOCS_USER_DATA)

let window
let host
let pending = process.argv.find(value => /\.(pdf|docx?)$/i.test(value))

async function openDocument(filename) {
  if (!filename || !host) return
  try {
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
      await openDocument(selection.filePaths[0])
    })
    ipcMain.handle("save-document", async (event, id) => {
      if (event.sender !== window.webContents) return false
      const { filename, bytes } = await host.exportFile(id)
      const result = await dialog.showSaveDialog(window, { defaultPath: filename })
      if (result.canceled) return false
      await fs.writeFile(result.filePath, bytes)
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
