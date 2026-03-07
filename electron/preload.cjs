const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    resolveYouTubeSearch: (query) => ipcRenderer.invoke('music:resolve-youtube-search', query),
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
        const handler = (_event, isMaximized) => callback(isMaximized)
        ipcRenderer.on('window:maximized-change', handler)
        return () => ipcRenderer.removeListener('window:maximized-change', handler)
    },
})
