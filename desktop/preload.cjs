// desktop/preload.cjs — safe bridge between the renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('devagent', {
  send: (text) => ipcRenderer.invoke('chat:send', text),
  clear: () => ipcRenderer.invoke('chat:clear'),
  pickWorkdir: () => ipcRenderer.invoke('workdir:pick'),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  activate: (key) => ipcRenderer.invoke('license:activate', key),
  on: (channel, cb) => {
    const allowed = ['ready', 'log', 'assistant', 'tool', 'status'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
