const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('azurecordDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  getBackendInfo: () => ipcRenderer.invoke('desktop:backend-info'),
  notify: (title, body) => ipcRenderer.invoke('desktop:notify', { title, body }),
  getSecureSession: () => ipcRenderer.invoke('desktop:secure-session-get'),
  setSecureSession: (token) => ipcRenderer.invoke('desktop:secure-session-set', token),
  deleteSecureSession: () => ipcRenderer.invoke('desktop:secure-session-delete')
});
