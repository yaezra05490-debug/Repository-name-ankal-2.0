const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  googleLogin: () => ipcRenderer.invoke("ankal:google-login"),
  saveWorkspace: json => ipcRenderer.invoke("ankal:save-workspace", json),
  checkUpdate: () => ipcRenderer.invoke("ankal:check-update"),
  // גיבוי קיוליקס: קריאה וכתיבה בכרטיס הזיכרון (או בתיקייה שנבחרה) דרך התהליך הראשי
  qualix: {
    listCards: () => ipcRenderer.invoke("qualix:list-cards"),
    chooseFolder: () => ipcRenderer.invoke("qualix:choose-folder"),
    list: (root, rel) => ipcRenderer.invoke("qualix:list", root, rel),
    read: (root, rel) => ipcRenderer.invoke("qualix:read", root, rel),
    write: (root, rel, data) => ipcRenderer.invoke("qualix:write", root, rel, data),
    mkdir: (root, rel) => ipcRenderer.invoke("qualix:mkdir", root, rel),
    remove: (root, rel) => ipcRenderer.invoke("qualix:remove", root, rel),
    exists: (root, rel) => ipcRenderer.invoke("qualix:exists", root, rel),
    utimes: (root, rel, mtimeMs) => ipcRenderer.invoke("qualix:utimes", root, rel, mtimeMs)
  }
});
