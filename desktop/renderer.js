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
    if (proc?.running) return { label: 'Calisiyor', className: 'status-running' };
    if (proc?.lastExitCode !== null && proc?.lastExitCode !== undefined) return { label: 'Durdu', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-idle' };
}

function mapRegistryHealth(health) {
    if (health?.ok) return { label: 'Bagli', className: 'status-active' };
    if (health?.error) return { label: 'Ulasilamiyor', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function mapBackendHealth(health) {
    if (health?.ok) return { label: 'Hazir', className: 'status-active' };
    if (health?.error) return { label: 'Kapali', className: 'status-error' };
    return { label: 'Bekliyor', className: 'status-unknown' };
}

function mapExtensionUpdate(update) {
    if (update?.available) return { label: 'Yeni Surum Var', className: 'status-warning' };
    if (update?.version) return { label: 'Guncel Paket', className: 'status-active' };
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
        ? 'Bu ayar aktifse uygulama Windows acilisinda tray olarak baslar.'
        : 'Startup ayari su an yalnizca Windows tarafinda anlamlidir.';

    setStatus('registry-status', 'registry-detail', mapRegistryHealth(state.registryHealth), state.registryHealth?.ok
        ? `Registry erisimi aktif. Son kontrol: ${formatTime(state.registryHealth.checked_at)}`
        : (state.registryHealth?.error || 'Merkezi servis bekleniyor'));

    setStatus('backend-status', 'backend-detail', mapBackendHealth(state.backendHealth), state.backendHealth?.ok
        ? `Backend saglikli. Son kontrol: ${formatTime(state.backendHealth.time)}`
        : (state.backendHealth?.error || 'Yerel backend kapali'));

    setStatus('worker-status', 'worker-detail', mapProcessState(state.worker), state.worker?.running
        ? 'Worker arka planda tarama yapiyor'
        : (state.worker?.lastError || 'Worker su an kapali'));

    const accessState = mapAccessState(state.access);
    const accessDetail = state.access?.blocked
        ? `${state.access.reason || 'Bu cihaz bloke edildi'}${state.access.blocked_until ? ` | Bitis: ${formatTime(state.access.blocked_until)}` : ''}`
        : `Durum: ${state.access?.status || 'bilinmiyor'} | Son gorulme: ${formatTime(state.access?.checked_at)}`;
    setStatus('access-status', 'access-detail', accessState, accessDetail);

    const extensionState = mapExtensionUpdate(state.extensionUpdate);
    const extensionDetail = state.extensionUpdate?.available
        ? `Yeni surum ${state.extensionUpdate.version} hazir. Son kontrol: ${formatTime(state.extensionUpdate.checked_at)}`
        : (state.extensionUpdate?.version
            ? `Son paket ${state.extensionUpdate.version}. Dosya: ${state.extensionUpdate.file_name || '-'}`
            : (state.extensionUpdate?.error || 'Manifest bekleniyor'));
    setStatus('extension-status', 'extension-detail', extensionState, extensionDetail);

    $('extension-download-hint').textContent = state.extensionUpdate?.downloadedFile
        ? `Son indirilen dosya: ${state.extensionUpdate.downloadedFile}`
        : 'Yeni paket varsa Downloads klasorune indirilir.';
    $('extension-install-hint').textContent = state.extensionUpdate?.install_hint || "Windows store disi Chrome uzantisi otomatik kurulmaz; masaustu uygulama sadece yeni paketi indirir ve kurulum adimini gosterir.";
    $('install-guide-file').textContent = state.extensionUpdate?.downloadedFile
        ? `Dosya: ${state.extensionUpdate.downloadedFile}`
        : 'Downloads klasorune inen paketi ac.';

    const banner = $('block-banner');
    if (state.access?.blocked) {
        banner.classList.remove('hidden');
        banner.textContent = state.access.reason || 'Bu cihaz registry tarafinda engelli.';
    } else {
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    const logs = Array.isArray(state.logs) ? state.logs.join('\n') : [];
    $('logs').textContent = logs.join('\n');

    const summary = [];
    summary.push(state.backendHealth?.ok ? 'Backend hazir.' : 'Backend kapali.');
    summary.push(state.worker?.running ? 'Worker calisiyor.' : 'Worker bekliyor.');
    summary.push(state.access?.blocked ? 'Cihaz su an engelli.' : 'Cihaz aktif durumda.');
    summary.push(state.extensionUpdate?.available ? `Uzanti ${state.extensionUpdate.version} indirilmeyi bekliyor.` : 'Uzanti paket durumu normal.');
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

    $('open-registry').addEventListener('click', () => window.trackifyDesktop.openRegistryWindow());
    $('open-registry-external').addEventListener('click', () => window.trackifyDesktop.openRegistryExternal());
    $('open-local-api').addEventListener('click', () => window.trackifyDesktop.openExternal('http://127.0.0.1:3001/health'));
    $('launch-at-startup').addEventListener('change', async (event) => {
        await window.trackifyDesktop.setLaunchAtStartup(event.target.checked);
        await refreshState();
    });
    $('start-services').addEventListener('click', async () => {
        await window.trackifyDesktop.startServices();
        await refreshState();
    });
    $('stop-services').addEventListener('click', async () => {
        await window.trackifyDesktop.stopServices();
        await refreshState();
    });
    $('restart-services').addEventListener('click', async () => {
        await window.trackifyDesktop.restartServices();
        await refreshState();
    });
    $('check-extension-update').addEventListener('click', async () => {
        await window.trackifyDesktop.checkExtensionUpdate();
        await refreshState();
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
    $('open-chrome-extensions').addEventListener('click', () => window.trackifyDesktop.openExternal('chrome://extensions'));
    $('dismiss-install-guide').addEventListener('click', async () => {
        await window.trackifyDesktop.dismissInstallGuide();
        await refreshState();
    });
    $('clear-logs').addEventListener('click', async () => {
        await window.trackifyDesktop.clearLogs();
        await refreshState();
    });
    $('quit-app').addEventListener('click', () => window.trackifyDesktop.quit());
    $('onboarding-open-registry').addEventListener('click', () => window.trackifyDesktop.openRegistryWindow());
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
