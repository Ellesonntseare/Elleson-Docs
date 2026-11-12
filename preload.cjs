const { contextBridge, ipcRenderer } = require("electron")
contextBridge.exposeInMainWorld("desktopDocs", {
  open: () => ipcRenderer.invoke("pick-document"),
  save: (id, options) => ipcRenderer.invoke("save-document", id, options)
})
