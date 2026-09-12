const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFile: (options) => ipcRenderer.invoke('dialog:saveFile', options),
  readFile: (filePath, encoding) => ipcRenderer.invoke('fs:readFile', filePath, encoding),
  writeFile: (filePath, data, encoding) => ipcRenderer.invoke('fs:writeFile', filePath, data, encoding),
  geMapping: () => ipcRenderer.invoke('ge:mapping'),
  geLatest: () => ipcRenderer.invoke('ge:latest'),
  geVolume1h: () => ipcRenderer.invoke('ge:volume1h'),
  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),
});
