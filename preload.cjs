const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("desktopDocs", {
  open: () => ipcRenderer.invoke("pick-document"),
  saveConverted: (name, bytes) => ipcRenderer.invoke("save-converted", name, bytes),
  save: (id, options) => ipcRenderer.invoke("save-document", id, options),
  saveOriginal: id => ipcRenderer.invoke("save-original", id)
  ,rename: (id, name) => ipcRenderer.invoke("rename-document", id, name)
})
