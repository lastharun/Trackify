const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, Notification } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PANEL_URL = process.env.TRACKIFY_PANEL_URL || 'https://registry.harunhatirkirmaz.com/panel/';
const LOCAL_API = process.env.TRACKIFY_LOCAL_API || 'http://127.0.0.1:3001';
const REGISTRY_API = process.env.TRACKIFY_REGISTRY_API || 'https://registry.harunhatirkirmaz.com/api';
const DEFAULT_USER_TELEGRAM_BOT_TOKEN = process.env.TRACKIFY_SHARED_TELEGRAM_BOT_TOKEN || '8343838308:AAHPdqmy4iGGsqM-RLqZCAZ3R1MiYikAjUw';
const MAX_LOG_LINES = 200;
const STATUS_POLL_MS = 15 * 1000;
const STARTUP_REFRESH_DELAYS = [1500, 5000];
const rootDir = path.join(__dirname, '..');
const buildMetaFile = path.join(__dirname, 'build-meta.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backendProcess = null;
let workerProcess = null;
let statusTimer = null;
let logs = [];
let desktopAccessState = { status: 'unknown', blocked: false, reason: null, blocked_until: null };
let desktopDevice = null;
let extensionUpdateState = { version: null, available: false, checked_at: null, downloadedFile: null };
let desktopUpdateState = {
    version: null,
    build_id: null,
    available: false,
    checked_at: null,
    downloadedFile: null,
    downloading: false,
    downloadProgress: 0,
    downloadBytes: 0,
    downloadTotalBytes: 0,
    installing: false
};

function getRegistryBaseUrl() {
    return REGISTRY_API.replace(/\/api$/, '');
}

function getBuildMeta() {
    try {
        return JSON.parse(fs.readFileSync(buildMetaFile, 'utf8'));
    } catch {
        return {
            product: 'trackify-desktop',
            version: app.getVersion(),
            build_id: 'unknown',
            built_at: null
        };
    }
}

function getDesktopVersionState() {
    const meta = getBuildMeta();
    return {
        version: String(meta.version || app.getVersion() || '0.0.0'),
        build_id: String(meta.build_id || 'unknown'),
        built_at: meta.built_at || null
    };
}

function getExtensionFallbackState() {
    return {
        product: 'trackify-extension',
        version: extensionUpdateState?.version || null,
        file_name: 'Trackify-Extension-latest.zip',
        download_url: '/downloads/Trackify-Extension-latest.zip',
        latest_download_url: '/downloads/Trackify-Extension-latest.zip',
        install_hint: 'Manifest olmasa bile son yüklenen ZIP indirilebilir. Kurulum kullanıcı tarafında chrome://extensions ekranından manuel yapılır.'
    };
}

function shouldOfferDesktopUpdate(manifest) {
    const current = getDesktopVersionState();
    if (!manifest) return false;
    const versionDiff = compareVersions(manifest.version, current.version);
    if (versionDiff > 0) return true;
    if (versionDiff < 0) return false;
    return Boolean(manifest.build_id && current.build_id && manifest.build_id !== current.build_id);
}

function scheduleStateRefresh(delays = STARTUP_REFRESH_DELAYS) {
    for (const delay of delays) {
        setTimeout(() => {
            publishState().catch(() => { });
        }, delay);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1520,
        height: 980,
        minWidth: 1180,
        minHeight: 800,
        title: 'Trackify Control Center',
        backgroundColor: '#0b1020',
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    mainWindow.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        mainWindow.hide();
    });
}

function pushLog(source, message) {
    const line = `[${new Date().toLocaleTimeString('tr-TR')}] [${source}] ${String(message).trim()}`;
    logs.push(line);
    if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
    publishState().catch(() => { });
}

function getStableDeviceId() {
    const interfaces = os.networkInterfaces();
    const macs = Object.values(interfaces)
        .flat()
        .filter(Boolean)
        .map((item) => String(item.mac || '').trim().toLowerCase())
        .filter((mac) => mac && mac !== '00:00:00:00:00:00');

    const uniqueMacs = [...new Set(macs)].sort();
    const fingerprint = [os.hostname(), os.platform(), os.arch(), uniqueMacs.join('|')].join('::');
    const digest = crypto.createHash('sha256').update(fingerprint).digest('hex');
    return `trackify-${digest.slice(0, 32)}`;
}

function getDeviceFile() {
    return path.join(app.getPath('userData'), 'desktop-device.json');
}

function getRuntimeDataDir() {
    const dir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getAppRuntimeRoot() {
    return app.isPackaged ? app.getAppPath() : rootDir;
}

function getServiceWorkingDirectory() {
    return app.isPackaged ? process.resourcesPath : rootDir;
}

function getRuntimeSchemaPath() {
    return path.join(getAppRuntimeRoot(), 'database', 'schema.sql');
}

function getServiceEntryPath(service) {
    return path.join(getAppRuntimeRoot(), 'dist', service, 'index.js');
}

function openChromeExtensionsPage() {
    const targetUrl = 'chrome://extensions/';
    if (process.platform === 'win32') {
        const candidates = [
            path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
        ].filter(Boolean);

        for (const executable of candidates) {
            if (!fs.existsSync(executable)) continue;
            spawn(executable, [targetUrl], { detached: true, stdio: 'ignore' }).unref();
            return true;
        }

        spawn('cmd.exe', ['/c', 'start', '', 'chrome', targetUrl], { detached: true, stdio: 'ignore' }).unref();
        return true;
    }

    shell.openExternal(targetUrl);
    return true;
}

function getDesktopPrefsFile() {
    return path.join(app.getPath('userData'), 'desktop-prefs.json');
}

function readDesktopPrefs() {
    const file = getDesktopPrefsFile();
    if (!fs.existsSync(file)) return {};
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return {};
    }
}

function writeDesktopPrefs(nextPrefs) {
    fs.writeFileSync(getDesktopPrefsFile(), JSON.stringify(nextPrefs, null, 2));
}

function getDesktopPrefs() {
    const prefs = readDesktopPrefs();
    return {
        onboardingCompleted: Boolean(prefs.onboardingCompleted),
        launchAtStartup: Boolean(prefs.launchAtStartup),
        installGuideDismissed: Boolean(prefs.installGuideDismissed),
        lastNotifiedExtensionVersion: prefs.lastNotifiedExtensionVersion || null,
        lastDownloadedExtensionFile: prefs.lastDownloadedExtensionFile || null,
        lastNotifiedDesktopBuildId: prefs.lastNotifiedDesktopBuildId || null,
        lastDownloadedDesktopInstaller: prefs.lastDownloadedDesktopInstaller || null
    };
}

function compareVersions(a, b) {
    const left = String(a || '').split('.').map((n) => Number(n) || 0);
    const right = String(b || '').split('.').map((n) => Number(n) || 0);
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i += 1) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function getLaunchAtStartup() {
    const prefs = getDesktopPrefs();
    if (process.platform !== 'win32') {
        return prefs.launchAtStartup;
    }
    try {
        return Boolean(app.getLoginItemSettings().openAtLogin);
    } catch {
        return prefs.launchAtStartup;
    }
}

function setLaunchAtStartup(enabled) {
    const prefs = getDesktopPrefs();
    writeDesktopPrefs({
        ...prefs,
        launchAtStartup: Boolean(enabled)
    });

    if (process.platform !== 'win32') return prefs;

    try {
        app.setLoginItemSettings({
            openAtLogin: Boolean(enabled),
            path: process.execPath,
            args: []
        });
    } catch (error) {
        pushLog('desktop', `Başlangıç ayarı yazılamadı: ${error.message}`);
    }

    return getDesktopPrefs();
}

function updateDesktopPrefs(patch) {
    const nextPrefs = {
        ...getDesktopPrefs(),
        ...patch
    };
    writeDesktopPrefs(nextPrefs);
    return nextPrefs;
}

function ensureDesktopDevice() {
    if (desktopDevice) return desktopDevice;
    const file = getDeviceFile();
    if (fs.existsSync(file)) {
        try {
            desktopDevice = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (desktopDevice?.device_id) return desktopDevice;
        } catch { }
    }

    desktopDevice = {
        device_id: getStableDeviceId(),
        device_name: `Trackify Desktop ${os.hostname()}`,
        platform: `${os.platform()} ${os.arch()}`
    };
    fs.writeFileSync(file, JSON.stringify(desktopDevice, null, 2));
    return desktopDevice;
}

async function fetchJson(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function refreshRegistryAccess(mode = 'heartbeat') {
    const device = ensureDesktopDevice();
    const endpoint = mode === 'register' ? '/devices/register' : '/devices/heartbeat';
    try {
        const data = await fetchJson(`${REGISTRY_API}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-trackify-device-id': device.device_id
            },
            body: JSON.stringify({
                device_id: device.device_id,
                device_name: device.device_name,
                platform: device.platform,
                user_agent: `Trackify Desktop / Electron ${process.versions.electron}`,
                app_version: app.getVersion()
            })
        });

        const wasBlocked = Boolean(desktopAccessState?.blocked);
        desktopAccessState = {
            status: data?.status || 'active',
            blocked: Boolean(data?.blocked),
            reason: data?.reason || null,
            blocked_until: data?.blocked_until || null,
            checked_at: new Date().toISOString()
        };

        if (desktopAccessState.blocked && !wasBlocked) {
            new Notification({
                title: 'Trackify erişimi kapatıldı',
                body: desktopAccessState.reason || 'Bu masaüstü cihaz registry tarafında engellendi.'
            }).show();
            await stopManagedServices();
        }

        if (!desktopAccessState.blocked && wasBlocked) {
            new Notification({
                title: 'Trackify erişimi açıldı',
                body: 'Masaüstü cihaz tekrar aktif duruma geçti.'
            }).show();
        }
    } catch (error) {
        desktopAccessState = {
            ...desktopAccessState,
            status: desktopAccessState?.status || 'unknown',
            checked_at: new Date().toISOString(),
            error: error.message
        };
        pushLog('registry', `Erişim kontrol hatası: ${error.message}`);
    }
}

async function checkExtensionUpdate() {
    try {
        const manifest = await fetchJson(`${REGISTRY_API}/updates/extension`);
        const prefs = readDesktopPrefs();
        const knownVersion = prefs.lastNotifiedExtensionVersion || '0.0.0';

        extensionUpdateState = {
            ...manifest,
            available: compareVersions(manifest?.version, knownVersion) > 0,
            checked_at: new Date().toISOString(),
            downloadedFile: prefs.lastDownloadedExtensionFile || null
        };

        if (extensionUpdateState.available && prefs.lastNotifiedExtensionVersion !== manifest.version) {
            new Notification({
                title: 'Yeni Trackify uzantı sürümü var',
                body: `Yeni sürüm ${manifest.version} indirilmeye hazır.`
            }).show();
            writeDesktopPrefs({
                ...prefs,
                lastNotifiedExtensionVersion: manifest.version,
                installGuideDismissed: false
            });
        }
    } catch (error) {
        try {
            const latestUrl = new URL('/downloads/Trackify-Extension-latest.zip', `${getRegistryBaseUrl()}/`).toString();
            const latestRes = await fetch(latestUrl, { method: 'HEAD' });
            if (latestRes.ok) {
                const prefs = readDesktopPrefs();
                extensionUpdateState = {
                    ...getExtensionFallbackState(),
                    available: false,
                    checked_at: new Date().toISOString(),
                    downloadedFile: prefs.lastDownloadedExtensionFile || null,
                    error: null
                };
                pushLog('extension-update', 'Manifest bulunamadı, son ZIP fallback ile kullanılacak.');
                return;
            }
        } catch {
            // Ignore fallback probe errors and expose the manifest error below.
        }

        extensionUpdateState = {
            ...extensionUpdateState,
            error: error.message,
            checked_at: new Date().toISOString()
        };
        pushLog('extension-update', `Manifest kontrol hatası: ${error.message}`);
    }
}

async function checkDesktopUpdate() {
    try {
        const manifest = await fetchJson(`${REGISTRY_API}/updates/desktop`);
        const prefs = readDesktopPrefs();
        const current = getDesktopVersionState();
        const available = shouldOfferDesktopUpdate(manifest);

        desktopUpdateState = {
            ...manifest,
            current_version: current.version,
            current_build_id: current.build_id,
            available,
            checked_at: new Date().toISOString(),
            downloadedFile: prefs.lastDownloadedDesktopInstaller || null,
            downloading: false,
            downloadProgress: 0,
            downloadBytes: 0,
            downloadTotalBytes: 0,
            installing: false,
            error: null
        };

        if (available && prefs.lastNotifiedDesktopBuildId !== manifest.build_id) {
            new Notification({
                title: 'Yeni Trackify masaüstü sürümü var',
                body: `Yeni masaüstü paketi ${manifest.version} indirilmeye hazır.`
            }).show();
            writeDesktopPrefs({
                ...prefs,
                lastNotifiedDesktopBuildId: manifest.build_id || `${manifest.version || 'unknown'}`
            });
        }
    } catch (error) {
        desktopUpdateState = {
            ...desktopUpdateState,
            error: error.message,
            checked_at: new Date().toISOString()
        };
        pushLog('desktop-update', `Manifest kontrol hatası: ${error.message}`);
    }
}

async function downloadExtensionUpdate() {
    await checkExtensionUpdate();
    if (!extensionUpdateState?.download_url) {
        extensionUpdateState = {
            ...extensionUpdateState,
            ...getExtensionFallbackState()
        };
    }
    if (!extensionUpdateState?.download_url) {
        throw new Error('ZIP paketi bulunamadı.');
    }

    const downloadUrl = new URL(extensionUpdateState.download_url, `${getRegistryBaseUrl()}/`).toString();
    const targetPath = path.join(app.getPath('downloads'), extensionUpdateState.file_name || `Trackify-Extension-${extensionUpdateState.version || 'latest'}.zip`);
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));

    const prefs = readDesktopPrefs();
    writeDesktopPrefs({
        ...prefs,
        lastDownloadedExtensionFile: targetPath,
        installGuideDismissed: false
    });
    extensionUpdateState.downloadedFile = targetPath;

    new Notification({
        title: 'Uzantı paketi indirildi',
        body: `Dosya kaydedildi: ${path.basename(targetPath)}`
    }).show();

    shell.showItemInFolder(targetPath);
    return targetPath;
}

async function downloadDesktopUpdate() {
    await checkDesktopUpdate();
    const relativeUrl = desktopUpdateState?.download_url || desktopUpdateState?.latest_download_url;
    if (!relativeUrl) {
        throw new Error('Masaüstü güncelleme paketi bulunamadı.');
    }

    const downloadUrl = new URL(relativeUrl, `${getRegistryBaseUrl()}/`).toString();
    const targetPath = path.join(
        app.getPath('downloads'),
        desktopUpdateState.file_name || `Trackify-Desktop-${desktopUpdateState.version || 'latest'}.exe`
    );
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const totalBytes = Number(res.headers.get('content-length') || 0);
    desktopUpdateState = {
        ...desktopUpdateState,
        downloading: true,
        downloadProgress: 0,
        downloadBytes: 0,
        downloadTotalBytes: totalBytes,
        error: null
    };
    await publishState();

    const fileStream = fs.createWriteStream(targetPath);
    const reader = res.body?.getReader();
    let downloadedBytes = 0;

    if (!reader) {
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(targetPath, buffer);
        downloadedBytes = buffer.length;
    } else {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            downloadedBytes += chunk.length;
            fileStream.write(chunk);
            desktopUpdateState = {
                ...desktopUpdateState,
                downloading: true,
                downloadBytes: downloadedBytes,
                downloadTotalBytes: totalBytes,
                downloadProgress: totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0
            };
            await publishState();
        }
        await new Promise((resolve, reject) => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
            fileStream.end();
        });
    }

    const prefs = readDesktopPrefs();
    writeDesktopPrefs({
        ...prefs,
        lastDownloadedDesktopInstaller: targetPath
    });
    desktopUpdateState = {
        ...desktopUpdateState,
        downloadedFile: targetPath,
        downloading: false,
        downloadBytes: downloadedBytes || totalBytes,
        downloadTotalBytes: totalBytes,
        downloadProgress: 100
    };

    new Notification({
        title: 'Masaüstü güncellemesi indirildi',
        body: `Kurulum dosyası hazır: ${path.basename(targetPath)}`
    }).show();

    shell.showItemInFolder(targetPath);
    return targetPath;
}

async function installDesktopUpdate() {
    const prefs = getDesktopPrefs();
    const installerPath = desktopUpdateState?.downloadedFile || prefs.lastDownloadedDesktopInstaller;
    if (!installerPath || !fs.existsSync(installerPath)) {
        throw new Error('Önce masaüstü güncellemesini indir.');
    }

    const installDir = app.isPackaged ? path.dirname(process.execPath) : null;
    const installerArgs = ['/S'];
    if (installDir && process.platform === 'win32') {
        installerArgs.push(`/D=${installDir}`);
    }

    desktopUpdateState = {
        ...desktopUpdateState,
        installing: true,
        error: null
    };
    await publishState();

    spawn(installerPath, installerArgs, {
        detached: true,
        stdio: 'ignore'
    }).unref();

    pushLog('desktop-update', `Sessiz güncelleme başlatıldı: ${path.basename(installerPath)}`);
    isQuitting = true;
    await stopManagedServices();
    app.quit();
    return installerPath;
}

function getProcessDescriptor(kind) {
    const target = kind === 'backend' ? backendProcess : workerProcess;
    return {
        running: Boolean(target && !target.killed),
        pid: target?.pid || null,
        lastExitCode: target?.exitCode ?? null,
        lastError: target?.lastError || null
    };
}

function attachProcessLogs(child, source) {
    child.stdout?.on('data', (chunk) => pushLog(source, chunk.toString()));
    child.stderr?.on('data', (chunk) => pushLog(source, chunk.toString()));
    child.on('exit', (code, signal) => {
        child.exitCode = code;
        child.lastError = signal ? `signal:${signal}` : null;
        pushLog(source, `Süreç kapandı code=${code ?? 'null'} signal=${signal ?? 'none'}`);
        publishState().catch(() => { });
    });
    child.on('error', (error) => {
        child.lastError = error.message;
        pushLog(source, `Süreç hatası: ${error.message}`);
        publishState().catch(() => { });
    });
}

async function startBackendProcess() {
    if (backendProcess && !backendProcess.killed) return;
    const runtimeEnv = {
        ...process.env,
        TRACKIFY_DB_DIR: getRuntimeDataDir(),
        TRACKIFY_SCHEMA_PATH: getRuntimeSchemaPath(),
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || DEFAULT_USER_TELEGRAM_BOT_TOKEN
    };
    const command = app.isPackaged ? process.execPath : process.execPath;
    const args = app.isPackaged
        ? [getServiceEntryPath('backend')]
        : ['--import', 'tsx', path.join(rootDir, 'backend/index.ts')];
    if (app.isPackaged) runtimeEnv.ELECTRON_RUN_AS_NODE = '1';

    backendProcess = spawn(command, args, {
        cwd: getServiceWorkingDirectory(),
        env: runtimeEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    attachProcessLogs(backendProcess, 'backend');
    pushLog('desktop', 'Backend başlatıldı.');
    scheduleStateRefresh();
}

async function startWorkerProcess() {
    if (workerProcess && !workerProcess.killed) return;
    const runtimeEnv = {
        ...process.env,
        TRACKIFY_DB_DIR: getRuntimeDataDir(),
        TRACKIFY_SCHEMA_PATH: getRuntimeSchemaPath(),
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || DEFAULT_USER_TELEGRAM_BOT_TOKEN
    };
    const command = app.isPackaged ? process.execPath : process.execPath;
    const args = app.isPackaged
        ? [getServiceEntryPath('workers')]
        : ['--import', 'tsx', path.join(rootDir, 'workers/index.ts')];
    if (app.isPackaged) runtimeEnv.ELECTRON_RUN_AS_NODE = '1';

    workerProcess = spawn(command, args, {
        cwd: getServiceWorkingDirectory(),
        env: runtimeEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    attachProcessLogs(workerProcess, 'worker');
    pushLog('desktop', 'Worker başlatıldı.');
    scheduleStateRefresh();
}

async function stopManagedServices() {
    for (const proc of [workerProcess, backendProcess]) {
        if (!proc || proc.killed) continue;
        proc.kill('SIGTERM');
    }
}

async function startManagedServices() {
    if (desktopAccessState.blocked) {
        pushLog('desktop', 'Servisler başlatılmadı: cihaz engelli.');
        return;
    }
    await startBackendProcess();
    await startWorkerProcess();
    scheduleStateRefresh();
}

async function restartManagedServices() {
    await stopManagedServices();
    setTimeout(() => {
        startManagedServices().catch((error) => pushLog('desktop', `Yeniden başlatma hatası: ${error.message}`));
    }, 800);
}

async function getBackendHealth() {
    try {
        return await fetchJson(`${LOCAL_API}/health`);
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function getRegistryHealth() {
    try {
        const data = await fetchJson(`${REGISTRY_API.replace(/\/api$/, '')}/health`);
        return { ...data, checked_at: new Date().toISOString() };
    } catch (error) {
        return { ok: false, error: error.message, checked_at: new Date().toISOString() };
    }
}

async function collectState() {
    const prefs = getDesktopPrefs();
    return {
        appInfo: getDesktopVersionState(),
        desktopDevice: ensureDesktopDevice(),
        access: desktopAccessState,
        backendHealth: await getBackendHealth(),
        registryHealth: await getRegistryHealth(),
        extensionUpdate: extensionUpdateState,
        desktopUpdate: desktopUpdateState,
        preferences: {
            ...prefs,
            launchAtStartup: getLaunchAtStartup(),
            platform: process.platform
        },
        backend: getProcessDescriptor('backend'),
        worker: getProcessDescriptor('worker'),
        logs
    };
}

async function publishState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('desktop:state', await collectState());
}

function createTray() {
    const iconPath = path.join(__dirname, '..', 'extension', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    tray.setToolTip('Trackify Control Center');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Masaüstü Panelini Aç', click: () => mainWindow?.show() },
        { label: 'Servisleri Başlat', click: () => startManagedServices() },
        { type: 'separator' },
        {
            label: 'Çıkış', click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));
    tray.on('click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else mainWindow.show();
    });
}

app.whenReady().then(() => {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return;
    }

    createWindow();
    createTray();
    ensureDesktopDevice();
    refreshRegistryAccess('register').catch(() => { });
    checkExtensionUpdate().catch(() => { });
    checkDesktopUpdate().catch(() => { });
    startManagedServices().catch((error) => pushLog('desktop', `Başlangıç hatası: ${error.message}`));
    statusTimer = setInterval(() => {
        refreshRegistryAccess('heartbeat').catch(() => { });
        checkExtensionUpdate().catch(() => { });
        checkDesktopUpdate().catch(() => { });
        publishState().catch(() => { });
    }, STATUS_POLL_MS);
    publishState().catch(() => { });
    scheduleStateRefresh([1000, 3000, 8000]);
});

app.on('before-quit', () => {
    isQuitting = true;
    if (statusTimer) clearInterval(statusTimer);
});

app.on('window-all-closed', (event) => {
    event.preventDefault();
});

app.on('second-instance', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
});

ipcMain.handle('desktop:get-state', async () => collectState());
ipcMain.handle('desktop:start-services', async () => {
    await refreshRegistryAccess('heartbeat');
    await startManagedServices();
    return collectState();
});
ipcMain.handle('desktop:check-extension-update', async () => {
    await checkExtensionUpdate();
    return collectState();
});
ipcMain.handle('desktop:download-extension-update', async () => {
    await downloadExtensionUpdate();
    return collectState();
});
ipcMain.handle('desktop:open-downloads-folder', async () => {
    shell.openPath(app.getPath('downloads'));
});
ipcMain.handle('desktop:check-desktop-update', async () => {
    await checkDesktopUpdate();
    return collectState();
});
ipcMain.handle('desktop:download-desktop-update', async () => {
    await downloadDesktopUpdate();
    return collectState();
});
ipcMain.handle('desktop:install-desktop-update', async () => {
    await installDesktopUpdate();
    return collectState();
});
ipcMain.handle('desktop:set-launch-at-startup', async (_event, enabled) => {
    setLaunchAtStartup(Boolean(enabled));
    return collectState();
});
ipcMain.handle('desktop:complete-onboarding', async () => {
    updateDesktopPrefs({ onboardingCompleted: true });
    return collectState();
});
ipcMain.handle('desktop:dismiss-install-guide', async () => {
    updateDesktopPrefs({ installGuideDismissed: true });
    return collectState();
});
ipcMain.handle('desktop:open-downloaded-extension', async () => {
    const prefs = getDesktopPrefs();
    if (prefs.lastDownloadedExtensionFile) {
        shell.showItemInFolder(prefs.lastDownloadedExtensionFile);
    }
});
ipcMain.handle('desktop:open-downloaded-desktop-installer', async () => {
    const prefs = getDesktopPrefs();
    if (prefs.lastDownloadedDesktopInstaller) {
        shell.showItemInFolder(prefs.lastDownloadedDesktopInstaller);
    }
});
ipcMain.handle('desktop:clear-logs', async () => {
    logs = [];
    return collectState();
});
ipcMain.handle('desktop:open-chrome-extensions', async () => openChromeExtensionsPage());
ipcMain.handle('desktop:quit', async () => {
    isQuitting = true;
    await stopManagedServices();
    app.quit();
});
