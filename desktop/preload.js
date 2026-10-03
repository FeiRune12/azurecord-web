const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('azurecordDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  appVersion: require('./package.json').version,
  getBackendInfo: () => ipcRenderer.invoke('desktop:backend-info'),
  cloudFetch: (payload) => ipcRenderer.invoke('desktop:cloud-fetch', payload),
  notify: (title, body) => ipcRenderer.invoke('desktop:notify', { title, body }),
  setBadgeCount: (count) => ipcRenderer.invoke('desktop:set-badge-count', Number(count) || 0),
  getSecureSession: () => ipcRenderer.invoke('desktop:secure-session-get'),
  setSecureSession: (token) => ipcRenderer.invoke('desktop:secure-session-set', token),
  deleteSecureSession: () => ipcRenderer.invoke('desktop:secure-session-delete'),
  getDisplaySources: () => ipcRenderer.invoke('desktop:display-sources'),
  selectDisplaySource: (sourceId) => ipcRenderer.invoke('desktop:display-source-select', sourceId),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload || {});
    ipcRenderer.on('desktop:update-status', handler);
    return () => ipcRenderer.removeListener('desktop:update-status', handler);
  }
});
