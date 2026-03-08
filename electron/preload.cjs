const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    getAppVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
    resolveYouTubeSearch: (query) => ipcRenderer.invoke('music:resolve-youtube-search', query),
    playMusic: (payload) => ipcRenderer.invoke('music:play', payload),
    pauseMusic: (seconds) => ipcRenderer.invoke('music:pause', seconds),
    resumeMusic: (seconds) => ipcRenderer.invoke('music:resume', seconds),
    seekMusic: (seconds) => ipcRenderer.invoke('music:seek', seconds),
    stopMusic: () => ipcRenderer.invoke('music:stop'),
    setMusicMuted: (muted) => ipcRenderer.invoke('music:set-muted', muted),
    getMusicState: () => ipcRenderer.invoke('music:get-state'),
    minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
    closeWindow: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMusicStateChange: (callback) => {
        const handler = (_event, payload) => callback(payload)
        ipcRenderer.on('music:state-change', handler)
        return () => ipcRenderer.removeListener('music:state-change', handler)
    },
    onMaximizedChange: (callback) => {
        const handler = (_event, isMaximized) => callback(isMaximized)
        ipcRenderer.on('window:maximized-change', handler)
        return () => ipcRenderer.removeListener('window:maximized-change', handler)
    },
})
