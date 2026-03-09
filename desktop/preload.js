const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

contextBridge.exposeInMainWorld('trackifyDesktop', {
    openExternal: (url) => shell.openExternal(url),
    openRegistryExternal: () => ipcRenderer.invoke('desktop:open-registry-external'),
    openRegistryWindow: () => ipcRenderer.invoke('desktop:open-registry-window'),
    startServices: () => ipcRenderer.invoke('desktop:start-services'),
    stopServices: () => ipcRenderer.invoke('desktop:stop-services'),
    restartServices: () => ipcRenderer.invoke('desktop:restart-services'),
    checkExtensionUpdate: () => ipcRenderer.invoke('desktop:check-extension-update'),
    downloadExtensionUpdate: () => ipcRenderer.invoke('desktop:download-extension-update'),
    openDownloadsFolder: () => ipcRenderer.invoke('desktop:open-downloads-folder'),
    setLaunchAtStartup: (enabled) => ipcRenderer.invoke('desktop:set-launch-at-startup', enabled),
    completeOnboarding: () => ipcRenderer.invoke('desktop:complete-onboarding'),
    dismissInstallGuide: () => ipcRenderer.invoke('desktop:dismiss-install-guide'),
    openDownloadedExtension: () => ipcRenderer.invoke('desktop:open-downloaded-extension'),
    clearLogs: () => ipcRenderer.invoke('desktop:clear-logs'),
    getState: () => ipcRenderer.invoke('desktop:get-state'),
    quit: () => ipcRenderer.invoke('desktop:quit'),
    copyText: async (value) => clipboard.writeText(String(value || '')),
    onStateChanged: (handler) => {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('desktop:state', listener);
        return () => ipcRenderer.removeListener('desktop:state', listener);
    }
});
