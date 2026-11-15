const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron")
const { durableWrite } = require('./durable-files.cjs')
const fs = require("node:fs/promises")
const path = require("node:path")
const { start } = require("./server.cjs")
if (process.env.ELLESON_DOCS_USER_DATA) app.setPath("userData", process.env.ELLESON_DOCS_USER_DATA)

let window
let host
let quitting = false
app.on('before-quit', () => { quitting = true })
let pending = process.argv.find(value => /\.(pdf|docx?|png|jpe?g|webp|gif|bmp)$/i.test(value))
const originalFiles = new Map()
let lockedDocument
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
    const bytes = await fs.readFile(filename)
    if (/\.pdf$/i.test(filename) && (await import('./document-extras.mjs')).needsPassword(bytes)) {
      lockedDocument={filename,bytes}
      window.webContents.send('pdf-password-needed',path.basename(filename)); return
    }
    const {pictureType}=await import('./web/picture-import.mjs')
    if(pictureType(filename)){
      const data=JSON.stringify(bytes.toString('base64'))
      const name=JSON.stringify(path.basename(filename))
      const result=await window.webContents.executeJavaScript(`(async()=>{
        const {openPictureAsPdf}=await import('/picture-import.mjs')
        const input=new File([Uint8Array.from(atob(${data}),c=>c.charCodeAt(0))],${name})
        const file=await openPictureAsPdf(input)
        return {name:file.name,bytes:await file.arrayBuffer()}
      })()`)
      const opened=await host.open(result.name,Buffer.from(result.bytes))
      return {picture:true,id:opened.id}
    }
    const opened = await host.open(path.basename(filename), bytes)
    originalFiles.set(opened.id, { filename, hash: hashBytes(bytes) })
    await rememberOriginalFiles()
  } catch (error) {
    dialog.showErrorBox("Could not open document", error.message)
  }
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on("second-instance", (_, args) => {
    const filename = args.find(value => /\.(pdf|docx?|png|jpe?g|webp|gif|bmp)$/i.test(value))
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
    ipcMain.handle('app-version',event=>{if(event.sender===window.webContents)return app.getVersion()})
    ipcMain.handle('download-update',async(event,url,digest)=>{
      if(event.sender!==window.webContents)throw Error('Open the updater from Elleson Docs.')
      const destination=await require('./update-download.cjs').downloadUpdate(url,digest,path.join(app.getPath('downloads'),'Elleson Docs updates'))
      shell.showItemInFolder(destination);return destination
    })
    ipcMain.handle("pick-document", async event => {
      if (event.sender !== window.webContents) return
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [
          {name:"Documents and pictures",extensions:["pdf","doc","docx","png","jpg","jpeg","webp","gif","bmp"]},
          {name:"Pictures",extensions:["png","jpg","jpeg","webp","gif","bmp"]},
          {name:"PDF and Word documents",extensions:["pdf","doc","docx"]}
        ]
      })
      return openDocument(selection.filePaths[0], true)
    })
    ipcMain.handle('unlock-document',async(event,password)=>{
      if(event.sender!==window.webContents||!lockedDocument)throw new Error('Select the protected PDF again.')
      if(password===null){lockedDocument=null;return false}
      const {filename,bytes}=lockedDocument
      const unlocked=(await import('./document-extras.mjs')).unlockPdf(bytes,password)
      await host.open(path.basename(filename).replace(/\.pdf$/i,' - unlocked.pdf'),Buffer.from(unlocked))
      lockedDocument=null
      return true
    })
    async function wordToPdf(values){
      if(!Array.isArray(values)||values.length>40*1024*1024||!values.every(value=>Number.isInteger(value)&&value>=0&&value<=255))throw new Error('Choose a Word document below 40 MB.')
      const printWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
      printWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}))
      try{
        await printWindow.loadURL(host.address+'/word-print.html')
        await printWindow.webContents.executeJavaScript(`(async()=>{const bytes=new Uint8Array(${JSON.stringify(values)});await window.renderWordForPrint(bytes);await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));const page=document.querySelector('section.docx');if(page){const style=getComputedStyle(page),rule=document.createElement('style');rule.textContent='@page { size: '+style.width+' '+style.minHeight+'; margin: 0; }';document.head.append(rule)}})()`)
        return Array.from(await printWindow.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,margins:{top:0,bottom:0,left:0,right:0}}))
      }finally{printWindow.destroy()}
    }
    host.setWordRenderer(wordToPdf)
    ipcMain.handle('word-to-pdf',(event,values)=>{if(event.sender!==window.webContents)throw Error('Invalid window');return wordToPdf(values)})
    ipcMain.handle("save-document", async (event, id, options) => {
      if (event.sender !== window.webContents) return false
      const exported = await host.exportFile(id, { flatten: options?.flatten === true })
      const { filename, bytes, changeNumber } = exported
      const result = await dialog.showSaveDialog(window, { defaultPath: options?.saveAs ? filename.replace(/ - copy(?=\.[^.]+$)/, "") : filename })
      if (result.canceled) return false
      if (path.extname(result.filePath).toLowerCase() !== "." + exported.extension) throw new Error("Keep the ." + exported.extension + " extension. Use Convert files for another format.")
      await durableWrite(result.filePath, bytes)
      await host.markSaved(id, changeNumber, exported)
      if (!originalFiles.has(id) || options?.saveAs) originalFiles.set(id, { filename: result.filePath, hash: hashBytes(bytes) })
      if (options?.saveAs && host.getDocument()?.extension === exported.extension) await host.renameDocument(id, path.basename(result.filePath))
      await rememberOriginalFiles()
      return true
    })
    ipcMain.handle("save-converted", async (event, name, values) => {
      if (event.sender !== window.webContents || typeof name !== "string" || !Array.isArray(values) || values.length > 200 * 1024 * 1024 || !values.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error("Invalid converted file.")
      const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(name), properties: ["showOverwriteConfirmation", "createDirectory"] })
      if (result.canceled) return false
      const temporary = result.filePath + ".elleson-" + require("node:crypto").randomUUID() + ".tmp"
      try { await durableWrite(result.filePath, Buffer.from(values)) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
      shell.showItemInFolder(result.filePath)
      return true
    })
    ipcMain.handle("rename-document", async (event, id, name) => {
      if (event.sender !== window.webContents || typeof name !== "string" || !name.trim() || name.length > 180 || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error("Choose a valid filename.")
      const original = originalFiles.get(id)
      if (original) {
        const destination = path.join(path.dirname(original.filename), name.trim())
        if (path.extname(destination).toLowerCase() !== path.extname(original.filename).toLowerCase()) throw new Error("Keep the current file extension.")
        if (destination === original.filename) return true
        // An exclusive copy avoids silently replacing another file with this name.
        await fs.copyFile(original.filename, destination, require("node:fs").constants.COPYFILE_EXCL)
        try { await fs.unlink(original.filename) } catch (error) { await fs.unlink(destination).catch(() => {}); throw error }
        original.filename = destination; await rememberOriginalFiles()
      }
      await host.renameDocument(id, name.trim()); return true
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
      try { await durableWrite(original.filename, exported.bytes) }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error }
      original.hash = hashBytes(exported.bytes)
      await rememberOriginalFiles()
      await host.markSaved(id, exported.changeNumber, exported)
      return { saved: true, destination: original.filename }
    })
    await window.loadURL(host.address + "/#owner=" + host.owner)
    await openDocument(pending)
  }).catch(error => {
    if (quitting || window?.isDestroyed()) return
    dialog.showErrorBox("Elleson Docs", error.message)
    app.quit()
  })
  app.on("window-all-closed", () => app.quit())
}
