function $(id) {
    return document.getElementById(id);
}

function setStatus(elId, detailId, state, detail) {
    const badge = $(elId);
    const detailEl = $(detailId);
    badge.textContent = state.label;
    badge.className = `status-badge ${state.className}`;
    detailEl.textContent = detail;
}

function formatTime(value) {
    if (!value) return '-';
    try {
        return new Date(value).toLocaleString('tr-TR');
    } catch {
        return String(value);
    }
}

function mapAccessState(access) {
    if (!access) return { label: 'Bilinmiyor', className: 'status-unknown' };
    if (access.blocked) return { label: 'Engelli', className: 'status-blocked' };
    if (access.status === 'active') return { label: 'Aktif', className: 'status-active' };
    if (access.status === 'license_expired') return { label: 'Lisans Bitti', className: 'status-warning' };
    return { label: access.status || 'Bilinmiyor', className: 'status-unknown' };
}

function mapProcessState(proc) {
    if (proc?.running) return { label: 'Çalışıyor', className: 'status-running' };
    if (proc?.lastExitCode !== null && proc?.lastExitCode !== undefined) return { label: 'Durdu', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-idle' };
}

function mapRegistryHealth(health) {
    if (health?.ok) return { label: 'Bağlı', className: 'status-active' };
    if (health?.error) return { label: 'Ulaşılamıyor', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function mapBackendHealth(health, proc) {
    if (health?.ok) return { label: 'Hazır', className: 'status-active' };
    if (proc?.running) return { label: 'Başlıyor', className: 'status-warning' };
    if (proc?.lastExitCode !== null && proc?.lastExitCode !== undefined) return { label: 'Çöktü', className: 'status-error' };
    if (health?.error) return { label: 'Kapalı', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function mapExtensionUpdate(update) {
    if (update?.available) return { label: 'Yeni Sürüm Var', className: 'status-warning' };
    if (update?.version) return { label: 'Güncel Paket', className: 'status-active' };
    if (update?.error) return { label: 'Kontrol Edilemedi', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function mapDesktopUpdate(update) {
    if (update?.available) return { label: 'Güncelleme Var', className: 'status-warning' };
    if (update?.version) return { label: 'Güncel', className: 'status-active' };
    if (update?.error) return { label: 'Kontrol Edilemedi', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function toggleHidden(id, hidden) {
    const el = $(id);
    if (!el) return;
    el.classList.toggle('hidden', hidden);
}

function renderState(state) {
    $('device-name').textContent = state.desktopDevice?.device_name || 'Trackify Desktop';
    $('device-id').textContent = `Device ID: ${state.desktopDevice?.device_id || '-'}`;
    $('launch-at-startup').checked = Boolean(state.preferences?.launchAtStartup);
    $('onboarding-launch-checkbox').checked = Boolean(state.preferences?.launchAtStartup);
    $('launch-at-startup').disabled = state.preferences?.platform !== 'win32';
    $('onboarding-launch-checkbox').disabled = state.preferences?.platform !== 'win32';
    $('launch-at-startup-hint').textContent = state.preferences?.platform === 'win32'
        ? 'Bu ayar aktifse uygulama Windows açılışında tray olarak başlar.'
        : 'Startup ayarı şu an yalnızca Windows tarafında anlamlıdır.';

    setStatus('registry-status', 'registry-detail', mapRegistryHealth(state.registryHealth), state.registryHealth?.ok
        ? `Registry erişimi aktif. Son kontrol: ${formatTime(state.registryHealth.checked_at)}`
        : (state.registryHealth?.error || 'Merkezi servis bekleniyor'));

    const backendDetail = state.backendHealth?.ok
        ? `Backend sağlıklı. Son kontrol: ${formatTime(state.backendHealth.time)}`
        : (state.backend?.running
            ? `Backend süreci açık ama health alınamadı${state.backendHealth?.error ? `: ${state.backendHealth.error}` : '...'}`
            : (state.backend?.lastError
                || (state.backend?.lastExitCode !== null && state.backend?.lastExitCode !== undefined
                    ? `Son çıkış kodu: ${state.backend.lastExitCode}`
                    : state.backendHealth?.error)
                || 'Yerel backend kapalı'));
    setStatus('backend-status', 'backend-detail', mapBackendHealth(state.backendHealth, state.backend), backendDetail);

    setStatus('worker-status', 'worker-detail', mapProcessState(state.worker), state.worker?.running
        ? 'Worker arka planda tarama yapıyor'
        : (state.worker?.lastError || 'Worker şu an kapalı'));

    const accessState = mapAccessState(state.access);
    const accessDetail = state.access?.blocked
        ? `${state.access.reason || 'Bu cihaz bloke edildi'}${state.access.blocked_until ? ` | Bitis: ${formatTime(state.access.blocked_until)}` : ''}`
        : `Durum: ${state.access?.status || 'bilinmiyor'} | Son görülme: ${formatTime(state.access?.checked_at)}`;
    setStatus('access-status', 'access-detail', accessState, accessDetail);

    const extensionState = mapExtensionUpdate(state.extensionUpdate);
    const extensionDetail = state.extensionUpdate?.available
        ? `Yeni sürüm ${state.extensionUpdate.version} hazır. Son kontrol: ${formatTime(state.extensionUpdate.checked_at)}`
        : (state.extensionUpdate?.version
            ? `Son paket ${state.extensionUpdate.version}. Dosya: ${state.extensionUpdate.file_name || '-'}`
            : (state.extensionUpdate?.download_url
                ? `Manifest olmasa da son yüklenen paket indirilebilir. Dosya: ${state.extensionUpdate.file_name || 'Trackify-Extension-latest.zip'}`
                : (state.extensionUpdate?.error || 'Manifest bekleniyor')))
    setStatus('extension-status', 'extension-detail', extensionState, extensionDetail);

    const desktopUpdateState = mapDesktopUpdate(state.desktopUpdate);
    const desktopUpdateDetail = state.desktopUpdate?.available
        ? `Yeni masaüstü paketi ${state.desktopUpdate.version} hazır. Build: ${String(state.desktopUpdate.build_id || '-').slice(0, 8)}`
        : (state.desktopUpdate?.version
            ? `Kurulu sürüm ${state.appInfo?.version || '-'}. Sunucudaki sürüm ${state.desktopUpdate.version}.`
            : (state.desktopUpdate?.error || 'Masaüstü güncelleme manifesti bekleniyor'));
    setStatus('desktop-update-status', 'desktop-update-detail', desktopUpdateState, desktopUpdateDetail);

    $('desktop-update-hint').textContent = state.desktopUpdate?.downloadedFile
        ? `Son indirilen kurulum: ${state.desktopUpdate.downloadedFile}`
        : 'Yeni Windows kurulum dosyası bulunduğunda Downloads klasörüne indirilebilir.';

    $('extension-download-hint').textContent = state.extensionUpdate?.downloadedFile
        ? `Son indirilen dosya: ${state.extensionUpdate.downloadedFile}`
        : 'Buton son yüklenen ZIP paketini Downloads klasörüne indirir.';
    $('extension-install-hint').textContent = state.extensionUpdate?.install_hint || "Windows store dışı Chrome uzantısı otomatik kurulmaz; masaüstü uygulama sadece yeni paketi indirir ve kurulum adımını gösterir.";
    $('install-guide-file').textContent = state.extensionUpdate?.downloadedFile
        ? `Dosya: ${state.extensionUpdate.downloadedFile}`
        : 'Downloads klasörüne inen paketi aç.';

    const banner = $('block-banner');
    if (state.access?.blocked) {
        banner.classList.remove('hidden');
        banner.textContent = state.access.reason || 'Bu cihaz registry tarafında engelli.';
    } else {
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    const logs = Array.isArray(state.logs) ? state.logs : [];
    $('logs').textContent = logs.join('\n');

    const summary = [];
    summary.push(state.backendHealth?.ok ? 'Backend hazır.' : (state.backend?.running ? 'Backend başlıyor.' : 'Backend kapalı.'));
    summary.push(state.worker?.running ? 'Worker çalışıyor.' : 'Worker bekliyor.');
    summary.push(state.access?.blocked ? 'Cihaz şu an engelli.' : 'Cihaz aktif durumda.');
    summary.push(
        state.desktopUpdate?.available
            ? `Masaüstü için ${state.desktopUpdate.version} güncellemesi hazır.`
            : 'Masaüstü sürümü kontrol edildi.'
    );
    summary.push(
        state.extensionUpdate?.available
            ? `Uzantı ${state.extensionUpdate.version} indirilmeyi bekliyor.`
            : (state.extensionUpdate?.download_url ? 'Son ZIP paketi indirilebilir.' : 'Uzantı paket durumu kontrol edilemedi.')
    );
    $('summary-text').textContent = summary.join(' ');

    toggleHidden('onboarding-overlay', Boolean(state.preferences?.onboardingCompleted));
    toggleHidden(
        'install-guide-card',
        !(state.extensionUpdate?.downloadedFile && !state.preferences?.installGuideDismissed)
    );
}

async function refreshState() {
    const state = await window.trackifyDesktop.getState();
    renderState(state);
}

window.trackifyDesktop.onStateChanged((state) => {
    renderState(state);
});

document.addEventListener('DOMContentLoaded', async () => {
    $('copy-device-id').addEventListener('click', async () => {
        const state = await window.trackifyDesktop.getState();
        if (!state.desktopDevice?.device_id) return;
        await window.trackifyDesktop.copyText(state.desktopDevice.device_id);
    });

    $('open-local-api').addEventListener('click', () => window.trackifyDesktop.openExternal('http://127.0.0.1:3001/health'));
    $('launch-at-startup').addEventListener('change', async (event) => {
        await window.trackifyDesktop.setLaunchAtStartup(event.target.checked);
        await refreshState();
    });
    $('start-services').addEventListener('click', async () => {
        await window.trackifyDesktop.startServices();
        await refreshState();
    });
    $('check-extension-update').addEventListener('click', async () => {
        await window.trackifyDesktop.checkExtensionUpdate();
        await refreshState();
    });
    $('check-desktop-update').addEventListener('click', async () => {
        await window.trackifyDesktop.checkDesktopUpdate();
        await refreshState();
    });
    $('download-desktop-update').addEventListener('click', async () => {
        await window.trackifyDesktop.downloadDesktopUpdate();
        await refreshState();
    });
    $('install-desktop-update').addEventListener('click', async () => {
        await window.trackifyDesktop.installDesktopUpdate();
    });
    $('open-downloaded-desktop-installer').addEventListener('click', async () => {
        await window.trackifyDesktop.openDownloadedDesktopInstaller();
    });
    $('download-extension-update').addEventListener('click', async () => {
        await window.trackifyDesktop.downloadExtensionUpdate();
        await refreshState();
    });
    $('open-downloads-folder').addEventListener('click', async () => {
        await window.trackifyDesktop.openDownloadsFolder();
    });
    $('open-downloaded-extension').addEventListener('click', async () => {
        await window.trackifyDesktop.openDownloadedExtension();
    });
    $('open-chrome-extensions').addEventListener('click', () => window.trackifyDesktop.openChromeExtensions());
    $('dismiss-install-guide').addEventListener('click', async () => {
        await window.trackifyDesktop.dismissInstallGuide();
        await refreshState();
    });
    $('clear-logs').addEventListener('click', async () => {
        await window.trackifyDesktop.clearLogs();
        await refreshState();
    });
    $('quit-app').addEventListener('click', () => window.trackifyDesktop.quit());
    $('onboarding-launch-checkbox').addEventListener('change', async (event) => {
        await window.trackifyDesktop.setLaunchAtStartup(event.target.checked);
        await refreshState();
    });
    $('onboarding-finish').addEventListener('click', async () => {
        await window.trackifyDesktop.completeOnboarding();
        await refreshState();
    });

    await refreshState();
});
