const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  googleLogin: () => ipcRenderer.invoke("ankal:google-login"),
  saveWorkspace: json => ipcRenderer.invoke("ankal:save-workspace", json),
  checkUpdate: () => ipcRenderer.invoke("ankal:check-update")
});
