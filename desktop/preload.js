const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

contextBridge.exposeInMainWorld('trackifyDesktop', {
    openExternal: (url) => shell.openExternal(url),
    startServices: () => ipcRenderer.invoke('desktop:start-services'),
    checkExtensionUpdate: () => ipcRenderer.invoke('desktop:check-extension-update'),
    downloadExtensionUpdate: () => ipcRenderer.invoke('desktop:download-extension-update'),
    checkDesktopUpdate: () => ipcRenderer.invoke('desktop:check-desktop-update'),
    downloadDesktopUpdate: () => ipcRenderer.invoke('desktop:download-desktop-update'),
    installDesktopUpdate: () => ipcRenderer.invoke('desktop:install-desktop-update'),
    openDownloadsFolder: () => ipcRenderer.invoke('desktop:open-downloads-folder'),
    setLaunchAtStartup: (enabled) => ipcRenderer.invoke('desktop:set-launch-at-startup', enabled),
    completeOnboarding: () => ipcRenderer.invoke('desktop:complete-onboarding'),
    dismissInstallGuide: () => ipcRenderer.invoke('desktop:dismiss-install-guide'),
    openDownloadedExtension: () => ipcRenderer.invoke('desktop:open-downloaded-extension'),
    openDownloadedDesktopInstaller: () => ipcRenderer.invoke('desktop:open-downloaded-desktop-installer'),
    openChromeExtensions: () => ipcRenderer.invoke('desktop:open-chrome-extensions'),
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
