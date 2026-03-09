const API = 'http://localhost:3001/api';

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(API)) return nativeFetch(input, init);

    const stored = await chrome.storage.local.get(['trackify_device_id']);
    const headers = new Headers(init.headers || {});
    if (stored?.trackify_device_id) headers.set('x-trackify-device-id', stored.trackify_device_id);
    return nativeFetch(input, { ...init, headers });
};

function renderBlockedOverlay(state) {
    if (!state?.blocked) return;
    if (document.getElementById('trackify-blocked-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'trackify-blocked-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,15,26,0.94);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.innerHTML = `
        <div style="max-width:520px;background:#18182a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px;color:#f8fafc;box-shadow:0 10px 30px rgba(0,0,0,0.35)">
            <div style="font-size:20px;font-weight:700;margin-bottom:10px">Bu cihaz devre disi</div>
            <div style="font-size:14px;color:#cbd5e1;line-height:1.6;margin-bottom:12px">${state.reason || 'Developer bu cihazin erisimini kapatti.'}</div>
            <div style="font-size:12px;color:#94a3b8">Cihaz ID: <code>${state.device_id || '-'}</code></div>
            ${state.blocked_until ? `<div style="font-size:12px;color:#94a3b8;margin-top:6px">Bloke bitis: ${state.blocked_until}</div>` : ''}
        </div>
    `;
    document.body.appendChild(overlay);
}

async function enforceAccessState() {
    const state = await new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action: 'refresh_access_status' }, (response) => {
                if (chrome.runtime.lastError) {
                    chrome.runtime.sendMessage({ action: 'get_access_status' }, (fallback) => resolve(fallback || { blocked: false }));
                    return;
                }
                resolve(response || { blocked: false });
            });
        } catch {
            resolve({ blocked: false });
        }
    });
    if (state?.blocked) renderBlockedOverlay(state);
    const deviceIdEl = document.getElementById('device-id-value');
    if (deviceIdEl) deviceIdEl.textContent = state?.device_id || '-';
    return state;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.trackify_access_state?.newValue?.blocked) return;
    renderBlockedOverlay(changes.trackify_access_state.newValue);
});

function normalizeProductForExport(product) {
    return {
        url: product.url,
        domain: product.domain,
        title: product.title || '',
        selector_price: product.selector_price || null,
        selector_secondary: product.selector_secondary || null,
        selector_title: product.selector_title || null,
        selector_image: product.selector_image || null,
        last_image_url: product.last_image_url || null,
        value_type: product.value_type || 'string',
        tracking_interval: Number(product.tracking_interval) || 10,
        wait_on_page: Number(product.wait_on_page) || 4,
        never_stop: Number(product.never_stop) ? 1 : 0,
        is_active: Number(product.is_active) ? 1 : 0,
        notification_telegram: Number(product.notification_telegram) ? 1 : 0,
        notification_browser: Number(product.notification_browser) ? 1 : 0,
        alert_condition_type: product.alert_condition_type || 'all',
        alert_condition_value: product.alert_condition_value || ''
    };
}

async function fetchAllProducts() {
    const limit = 500;
    let offset = 0;
    const all = [];

    while (true) {
        const res = await fetch(`${API}/products?limit=${limit}&offset=${offset}`);
        const data = await res.json();
        const rows = Array.isArray(data?.products) ? data.products : [];
        all.push(...rows);
        if (rows.length < limit) break;
        offset += limit;
    }

    return all;
}

function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportTrackingsJson() {
    try {
        const products = await fetchAllProducts();
        const payload = {
            app: 'trackify',
            version: 1,
            exported_at: new Date().toISOString(),
            products: products.map(normalizeProductForExport)
        };
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadJson(`trackify-trackings-${stamp}.json`, payload);
        showToast(`✅ ${products.length} takip JSON olarak dışa aktarıldı`);
    } catch {
        showToast('❌ JSON dışa aktarım başarısız');
    }
}

function parseImportedProducts(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.products)) return payload.products;
    throw new Error('invalid_json');
}

async function importTrackingsJson(file) {
    if (!file) return;

    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const products = parseImportedProducts(payload);
        if (!products.length) throw new Error('empty_json');

        let imported = 0;
        let failed = 0;

        for (const item of products) {
            try {
                const body = {
                    url: item.url,
                    domain: item.domain,
                    title: item.title || '',
                    selector_price: item.selector_price || null,
                    selector_secondary: item.selector_secondary || null,
                    selector_title: item.selector_title || null,
                    selector_image: item.selector_image || null,
                    last_image_url: item.last_image_url || null,
                    value_type: item.value_type || 'string',
                    trackingInterval: Number(item.tracking_interval) || 10,
                    wait_on_page: Number(item.wait_on_page) || 4,
                    never_stop: Number(item.never_stop) ? 1 : 0
                };

                const createRes = await fetch(`${API}/products`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const createData = await createRes.json();
                if (!createRes.ok || !createData?.id) throw new Error(createData?.error || 'create_failed');

                await fetch(`${API}/products/${createData.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: item.title || '',
                        tracking_interval: Number(item.tracking_interval) || 10,
                        wait_on_page: Number(item.wait_on_page) || 4,
                        never_stop: Number(item.never_stop) ? 1 : 0,
                        is_active: Number(item.is_active) ? 1 : 0,
                        notification_telegram: Number(item.notification_telegram) ? 1 : 0,
                        notification_browser: Number(item.notification_browser) ? 1 : 0,
                        alert_condition_type: item.alert_condition_type || 'all',
                        alert_condition_value: item.alert_condition_value || '',
                        value_type: item.value_type || 'string',
                        selector_title: item.selector_title || null,
                        selector_image: item.selector_image || null,
                        last_image_url: item.last_image_url || null
                    })
                });

                imported += 1;
            } catch {
                failed += 1;
            }
        }

        showToast(failed ? `⚠️ ${imported} takip içe aktarıldı, ${failed} kayıt atlandı` : `✅ ${imported} takip içe aktarıldı`);
    } catch {
        showToast('❌ Geçersiz veya bozuk JSON dosyası');
    }
}

// Helper: save to backend, fallback to chrome.storage
async function saveSetting(key, value) {
    try {
        await fetch(`${API}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: String(value) })
        });
    } catch {
        chrome.storage.sync.get(['settings'], ({ settings }) => {
            const s = settings || {};
            s[key] = value;
            chrome.storage.sync.set({ settings: s });
        });
    }
}

async function loadSettings() {
    let s = {};
    try {
        const res = await fetch(`${API}/settings`);
        s = await res.json();
    } catch {
        await new Promise(resolve => {
            chrome.storage.sync.get(['settings'], ({ settings }) => {
                s = settings || {};
                resolve();
            });
        });
    }

    // Apply values to UI
    setCheck('enable-parsing', s.enable_parsing !== '0');
    setCheck('keep-tab', s.keep_tab_open !== '0');
    setCheck('zero-price-invalid', s.zero_price_invalid === '1');
    setCheck('telegram-enabled', s.telegram_notifications !== '0');
    setCheck('send-errors', s.send_error_notifications !== '0');
    setCheck('browser-notif', s.browser_notifications === '1');
    setCheck('never-stop', s.never_stop_on_errors === '1');
    if (s.telegram_user_id) document.getElementById('telegram-id').value = s.telegram_user_id;
    if (s.telegram_bot_token) document.getElementById('telegram-bot-token').value = s.telegram_bot_token;
    if (s.language) document.getElementById('language').value = s.language;

    const iv = parseInt(s.default_interval || 10);
    document.getElementById('default-interval').value = iv;
    document.getElementById('default-interval-number').value = iv;
    document.getElementById('iv-label').textContent = fmt(iv);

    const disc = s.min_discount !== undefined ? parseInt(s.min_discount) : 0;
    document.getElementById('min-discount').value = disc;
    document.getElementById('discount-label').textContent = disc + '%';

    const wait = parseInt(s.wait_on_page || 4);
    document.getElementById('wait-on-page').value = wait;
    document.getElementById('wait-label').textContent = wait + 's';
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
}

function fmt(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function bindToggle(id, key) {
    document.getElementById(id)?.addEventListener('change', e => saveSetting(key, e.target.checked ? '1' : '0'));
}

function bindSlider(id, key, labelId, unit) {
    const el = document.getElementById(id);
    const lbl = document.getElementById(labelId);
    el?.addEventListener('input', e => {
        if (lbl) lbl.textContent = unit === 'time' ? fmt(parseInt(e.target.value)) : e.target.value + unit;
    });
    el?.addEventListener('change', e => saveSetting(key, e.target.value));
}

function bindIntervalControls() {
    const range = document.getElementById('default-interval');
    const number = document.getElementById('default-interval-number');
    const label = document.getElementById('iv-label');

    const applyValue = (raw, persist) => {
        const next = Math.max(1, Math.min(1440, parseInt(raw || '10', 10) || 10));
        range.value = String(next);
        number.value = String(next);
        label.textContent = fmt(next);
        if (persist) saveSetting('default_interval', String(next));
    };

    range?.addEventListener('input', e => applyValue(e.target.value, false));
    range?.addEventListener('change', e => applyValue(e.target.value, true));
    number?.addEventListener('input', e => applyValue(e.target.value, false));
    number?.addEventListener('change', e => applyValue(e.target.value, true));
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadLanguage();
    await enforceAccessState();
    await loadSettings();

    // Toggle bindings
    bindToggle('enable-parsing', 'enable_parsing');
    bindToggle('keep-tab', 'keep_tab_open');
    bindToggle('zero-price-invalid', 'zero_price_invalid');
    bindToggle('telegram-enabled', 'telegram_notifications');
    bindToggle('send-errors', 'send_error_notifications');
    bindToggle('browser-notif', 'browser_notifications');
    bindToggle('never-stop', 'never_stop_on_errors');

    // Slider bindings
    bindIntervalControls();
    bindSlider('min-discount', 'min_discount', 'discount-label', '%');
    bindSlider('wait-on-page', 'wait_on_page', 'wait-label', 's');

    // Language — save + apply immediately
    const langSelect = document.getElementById('language');
    langSelect?.addEventListener('change', async e => {
        const lang = e.target.value;
        await saveSetting('language', lang);
        // Apply immediately to this page
        applyLanguage(lang);
        // Update html lang attribute
        document.documentElement.lang = lang;
    });

    // Save Telegram
    document.getElementById('save-telegram')?.addEventListener('click', async () => {
        const id = document.getElementById('telegram-id').value.trim();
        const token = document.getElementById('telegram-bot-token').value.trim();
        await saveSetting('telegram_user_id', id);
        await saveSetting('telegram_bot_token', token);
        showToast('✅ Telegram ayarları kaydedildi!');
    });

    // Test Telegram
    document.getElementById('send-test')?.addEventListener('click', async () => {
        const id = document.getElementById('telegram-id').value.trim();
        if (!id) { showToast('❌ Önce User ID girin'); return; }
        try {
            const res = await fetch(`${API}/test-telegram`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: id })
            });
            const data = await res.json();
            showToast(data.success ? '✅ Test mesajı gönderildi!' : '❌ ' + (data.error || 'Hata'));
        } catch {
            showToast('❌ Backend bağlantısı yok (localhost:3001)');
        }
    });

    const importInput = document.getElementById('import-json-file');
    document.getElementById('export-json')?.addEventListener('click', exportTrackingsJson);
    document.getElementById('import-json')?.addEventListener('click', () => importInput?.click());
    importInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        await importTrackingsJson(file);
        e.target.value = '';
    });
});

function showToast(msg) {
    const t = document.getElementById('test-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 3000);
}
