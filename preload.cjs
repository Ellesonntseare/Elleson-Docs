const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("desktopDocs", {
  appVersion: () => ipcRenderer.invoke('app-version'),
  downloadUpdate: (url,digest) => ipcRenderer.invoke('download-update',url,digest),
  onPasswordRequired: callback => ipcRenderer.on('pdf-password-needed',(_,name)=>callback(name)),
  unlock: password => ipcRenderer.invoke('unlock-document',password),
  open: () => ipcRenderer.invoke("pick-document"),
  saveConverted: (name, bytes) => ipcRenderer.invoke("save-converted", name, bytes),
  wordToPdf: bytes => ipcRenderer.invoke('word-to-pdf',bytes),
  save: (id, options) => ipcRenderer.invoke("save-document", id, options),
  saveOriginal: id => ipcRenderer.invoke("save-original", id)
  ,rename: (id, name) => ipcRenderer.invoke("rename-document", id, name)
})
