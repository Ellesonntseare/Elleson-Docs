const { app, BrowserWindow, dialog, ipcMain } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const { start } = require("./server.cjs")
if (process.env.ELLESON_DOCS_USER_DATA) app.setPath("userData", process.env.ELLESON_DOCS_USER_DATA)

let window
let host
let pending = process.argv.find(value => /\.(pdf|docx?)$/i.test(value))
const originalFiles = new Map()
const hashBytes = bytes => require("node:crypto").createHash("sha256").update(bytes).digest("hex")
const fingerprint = async filename => hashBytes(await fs.readFile(filename))
async function rememberOriginalFiles() {
  const target = path.join(app.getPath("userData"), "original-files.json")
  try { await fs.writeFile(target + ".tmp", JSON.stringify([...originalFiles])); await fs.rename(target + ".tmp", target) } catch {}
}

async function openDocument(filename, confirmed = false) {
  if (!filename || !host) return
  filename = path.resolve(filename)
  try {
    if ((await fs.stat(filename)).size > host.maxBytes) throw new Error("Choose a file smaller than 40 MB.")
    const bytes = await fs.readFile(filename), opened = await host.open(path.basename(filename), bytes)
    originalFiles.set(opened.id, { filename, hash: hashBytes(bytes) })
    await rememberOriginalFiles()
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
    const portFile = path.join(app.getPath("userData"), "port.json")
    let preferred = process.env.ELLESON_DOCS_TEST === "1" ? 0 : 16943
    try { preferred = process.env.ELLESON_DOCS_TEST === "1" ? 0 : JSON.parse(await fs.readFile(portFile, "utf8")).port || preferred } catch {}
    try { host = await start(preferred, path.join(app.getPath("userData"), "recovery")) }
    catch (error) { if (error.code !== "EADDRINUSE") throw error; host = await start(0, path.join(app.getPath("userData"), "recovery")) }
    await fs.mkdir(app.getPath("userData"), { recursive: true })
    await fs.writeFile(portFile, JSON.stringify({ port: host.server.address().port }))
    try {
      const entries = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "original-files.json"), "utf8"))
      for (const [id, entry] of entries) if (/^[a-f0-9-]{36}$/.test(id) && typeof entry.filename === "string" && path.isAbsolute(entry.filename) && typeof entry.hash === "string") originalFiles.set(id, entry)
    } catch {}
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
      if (!originalFiles.has(id)) originalFiles.set(id, { filename: result.filePath, hash: hashBytes(bytes) })
      await rememberOriginalFiles()
      return true
    })
    ipcMain.handle("save-original", async (event, id) => {
      if (event.sender !== window.webContents) return false
      const original = originalFiles.get(id)
      if (!original) return { chooseCopy: true }
      const exported = await host.exportFile(id)
      if (path.extname(original.filename).toLowerCase() !== "." + exported.extension) return { chooseCopy: true }
      let actual
      try { actual = await fingerprint(original.filename) } catch { return { chooseCopy: true } }
      if (actual !== original.hash) {
        const result = await dialog.showMessageBox(window, { type: "warning", title: "File changed outside Elleson Docs", buttons: ["Cancel", "Save a copy", "Overwrite changed file"], defaultId: 1, cancelId: 0,
          message: "Another application changed this file.", detail: original.filename })
        if (result.response === 0) return false
        if (result.response === 1) return { chooseCopy: true }
      }
      const temporary = original.filename + ".elleson-" + Date.now() + ".tmp"
      try { await fs.writeFile(temporary, exported.bytes); await fs.rename(temporary, original.filename) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
      original.hash = hashBytes(exported.bytes)
      await rememberOriginalFiles()
      await host.markSaved(id, exported.changeNumber, exported)
      return { saved: true, destination: original.filename }
    })
    await window.loadURL(host.address + "/#owner=" + host.owner)
    await openDocument(pending)
  }).catch(error => {
    dialog.showErrorBox("Elleson Docs", error.message)
    app.quit()
  })
  app.on("window-all-closed", () => app.quit())
}
