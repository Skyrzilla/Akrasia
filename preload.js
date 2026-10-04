const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aurora', {
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  scanFolder: folder => ipcRenderer.invoke('scan-folder', folder),
  scanPlaylists: folder => ipcRenderer.invoke('scan-playlists', folder),
  deleteFiles: files => ipcRenderer.invoke('delete-files', files),
  showInFolder: file => ipcRenderer.invoke('show-in-folder', file),
  fileUrl: file => ipcRenderer.invoke('file-url', file)
});
