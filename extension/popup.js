const API = 'http://localhost:3001/api';
const PRODUCTS_REVISION_KEY = 'trackify_products_revision';
let currentTab = null;
let detectedInfo = null;
let manualSelectorMode = false;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(API)) return nativeFetch(input, init);

    const stored = await chrome.storage.local.get(['trackify_device_id']);
    const headers = new Headers(init.headers || {});
    if (stored?.trackify_device_id) headers.set('x-trackify-device-id', stored.trackify_device_id);
    return nativeFetch(input, { ...init, headers });
};

async function notifyProductsChanged(reason, productId) {
    await chrome.storage.local.set({
        [PRODUCTS_REVISION_KEY]: {
            reason: String(reason || 'updated'),
            productId: productId || null,
            at: Date.now()
        }
    });
}

function renderBlockedOverlay(state) {
    if (!state?.blocked) return;
    if (document.getElementById('trackify-blocked-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'trackify-blocked-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,15,26,0.96);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;';
    overlay.innerHTML = `
        <div style="max-width:420px;background:#18182a;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;color:#f8fafc">
            <div style="font-size:18px;font-weight:700;margin-bottom:8px">Bu cihaz engellendi</div>
            <div style="font-size:13px;color:#cbd5e1;line-height:1.5;margin-bottom:10px">${state.reason || 'Developer bu cihazin Trackify erisimini kapatti.'}</div>
            <div style="font-size:11px;color:#94a3b8">Cihaz ID: <code>${state.device_id || '-'}</code></div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function removeBlockedOverlay() {
    document.getElementById('trackify-blocked-overlay')?.remove();
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
    else removeBlockedOverlay();
    return state;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.trackify_access_state?.newValue) return;
    if (changes.trackify_access_state.newValue.blocked) renderBlockedOverlay(changes.trackify_access_state.newValue);
    else removeBlockedOverlay();
});

function inferValueType(value, fallback = 'string') {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return fallback;

    const stripped = normalized
        .replace(/(?:try|tl|usd|eur|gbp)/gi, '')
        .replace(/[0-9.,%+\-_/\\()[\]{}:;"'`~|!?@#$^&*=<>₺$€£¥₹\s]/g, '')
        .trim();

    return stripped ? 'string' : 'price';
}

function splitSelectorInput(value) {
    return String(value || '')
        .split(/\r?\n|,/)
        .map((part) => part.trim())
        .filter(Boolean);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await enforceAccessState();
    // Tracking list buttons
    document.getElementById('btn-list').addEventListener('click', openWatchlist);
    document.getElementById('view-list').addEventListener('click', openWatchlist);

    // ─── Scan Button ───────────────────────────────────────────────────────────
    const scanBtn = document.getElementById('btn-scan');
    const scanPanel = document.getElementById('scan-panel');
    let scanOpen = false;

    scanBtn.addEventListener('click', async () => {
        if (!currentTab || scanBtn.disabled) return;

        // Toggle off
        if (scanOpen) {
            scanPanel.style.display = 'none';
            scanOpen = false;
            scanBtn.textContent = '🔍   Sayfayı Tara — Takip Edilebilir Alanlar';
            return;
        }

        scanPanel.style.display = 'flex';
        scanPanel.innerHTML = '<div class="scan-loading">🔍 Taranıyor...</div>';
        scanBtn.disabled = true;
        scanBtn.textContent = '⏳ Taranıyor...';

        await tryInjectContent(currentTab.id);
        chrome.tabs.sendMessage(currentTab.id, { action: 'scan_page' }, (resp) => {
            scanBtn.disabled = false;
            scanBtn.textContent = '✖ Tarayıcıyı Kapat';
            scanOpen = true;

            if (chrome.runtime.lastError || !resp) {
                scanPanel.innerHTML = '<div class="scan-empty">⚠️ Sayfaya erişilemiyor — sayfayı yenile</div>';
                return;
            }

            const { results } = resp;
            if (!results?.length) {
                scanPanel.innerHTML = '<div class="scan-empty">Bu sayfada bilinen takip alanı bulunamadı.<br>Manuel seçici kullan veya 🎯 ile seç.</div>';
                return;
            }

            // Group by category
            const groups = {};
            for (const r of results) {
                if (!groups[r.category]) groups[r.category] = [];
                groups[r.category].push(r);
            }

            let html = '';
            for (const [cat, items] of Object.entries(groups)) {
                html += `<div class="scan-category">${cat}</div>`;
                for (const item of items) {
                    const valClass = item.hasValue ? 'has-value' : '';
                    const valDisplay = escHTML(item.value).substring(0, 60);
                    const selDisplay = escHTML(item.selector);
                    html += `
                        <div class="scan-row">
                            <div class="scan-row-info">
                                <div class="scan-row-label">${escHTML(item.label)}</div>
                                <div class="scan-row-value ${valClass}">${valDisplay}</div>
                                <div class="scan-row-sel">${selDisplay}</div>
                            </div>
                            <button class="btn-track-scan" data-sel="${escHTML(item.selector)}" data-label="${escHTML(item.label)}" data-cat="${escHTML(cat)}">
                                Takip Et
                            </button>
                        </div>`;
                }
            }
            scanPanel.innerHTML = html;

            // Bind track buttons
            scanPanel.querySelectorAll('.btn-track-scan').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const sel = btn.dataset.sel;
                    const label = btn.dataset.label;
                    const cat = btn.dataset.cat || '';
                    const isPrice = cat.toLowerCase().includes('fiyat');
                    const valueRow = btn.closest('.scan-row')?.querySelector('.scan-row-value')?.textContent || '';
                    const valueType = inferValueType(valueRow, isPrice ? 'price' : 'string');

                    btn.textContent = '⏳';
                    btn.disabled = true;
                    try {
                        const payload = {
                            url: currentTab.url,
                            domain: new URL(currentTab.url).hostname.replace('www.', '').split('.')[0],
                            title: currentTab.title,
                            value_type: valueType,
                            selector_price: sel,
                            is_active: 1
                        };

                        const res = await fetch(`${API}/products`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();
                        if (data.id) {
                            btn.textContent = '✅';
                            btn.style.background = '#10b981';
                            await notifyProductsChanged(data.appended ? 'selector-appended' : 'created', data.id);
                            if (data.appended) {
                                showToast('✅ Alan mevcut takibe eklendi!');
                            }
                        } else {
                            btn.textContent = '❌';
                        }
                    } catch {
                        btn.textContent = '❌';
                    }
                });
            });
        });
    });

    // Check if we just saved a product (toast)
    const { lastAdded } = await chrome.storage.local.get('lastAdded');
    if (lastAdded) {
        showToast('✅ Takip kaydedildi!');
        await chrome.storage.local.remove('lastAdded');
    }

    // Toggle manual CSS input visibility
    document.getElementById('toggle-manual').addEventListener('click', () => {
        manualSelectorMode = !manualSelectorMode;
        const sec = document.getElementById('selector-section');
        sec.style.display = manualSelectorMode ? 'flex' : 'none';
        document.getElementById('toggle-manual').textContent = manualSelectorMode
            ? '⬅️ Otomatik tespite dön'
            : '⚙️ Manuel CSS seçici';
    });

    // Selector track button
    document.getElementById('btn-selector-track')?.addEventListener('click', trackWithSelector);

    // Unified Pick button
    document.getElementById('btn-pick-price')?.addEventListener('pointerdown', () => { window.__target = 'unified'; });
    document.getElementById('btn-pick-price')?.addEventListener('click', async () => {
        if (!currentTab) return;
        await tryInjectContent(currentTab.id);
        chrome.tabs.sendMessage(currentTab.id, { action: 'pick_element', target: 'unified' }, (r) => {
            if (chrome.runtime.lastError) setStatus('⚠️ Sayfayı yenile ve tekrar dene');
            else window.close();
        });
    });

    // Remove the secondary pick button from UI in HTML if I could, but I'll just make it do the same or hide it.
    document.getElementById('btn-pick-secondary')?.style.setProperty('display', 'none');

    // Main auto-detect button
    document.getElementById('btn-main').addEventListener('click', async () => {
        if (detectedInfo) {
            // Quick track with auto-detected data
            await quickTrack(detectedInfo);
        } else {
            // Start guided selection
            if (!currentTab) { setStatus('Bir alışveriş sayfası aç'); return; }
            await tryInjectContent(currentTab.id);
            chrome.tabs.sendMessage(currentTab.id, { action: 'start_selection' }, (r) => {
                if (chrome.runtime.lastError) {
                    setStatus('⚠️ Sayfayı yenile ve tekrar dene');
                } else {
                    window.close();
                }
            });
        }
    });

    // Get current tab and detect
    await detectCurrentPage();
});

// ─── Page Detection ───────────────────────────────────────────────────────────
async function detectCurrentPage() {
    const btn = document.getElementById('btn-main');
    const label = document.getElementById('btn-label');
    const icon = document.getElementById('btn-icon');

    try {
        [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch { }

    const restricted = !currentTab || !currentTab.url ||
        currentTab.url.startsWith('chrome://') ||
        currentTab.url.startsWith('chrome-extension://') ||
        currentTab.url.startsWith('about:') ||
        currentTab.url.startsWith('edge://');

    if (restricted) {
        icon.textContent = '🛍️';
        label.textContent = 'Bir ürün sayfası aç';
        document.getElementById('toggle-manual').style.display = 'none';
        return;
    }

    // Try to get page info
    await tryInjectContent(currentTab.id);

    chrome.tabs.sendMessage(currentTab.id, { action: 'get_page_info' }, (info) => {
        if (chrome.runtime.lastError || !info) {
            // Can't communicate, show manual add
            icon.textContent = '➕';
            label.textContent = 'Takip Ekle';
            setStatus('Sayfada fiyat bulunamadı — Manuel seçim yapabilirsin');
            return;
        }

        detectedInfo = info;

        if (false) { // Hard disable auto detect for price
            // Show detected price
            const box = document.getElementById('detected-box');
            box.style.display = 'flex';
            document.getElementById('detected-price').textContent =
                info.detectedPrice.toLocaleString('tr-TR') + ' TRY';
            document.getElementById('detected-sel').textContent = info.detectedSelector || '';

            // Pre-fill price CSS input with detected selector
            const priceInput = document.getElementById('selector-price-input');
            if (priceInput && !priceInput.value) priceInput.value = info.detectedSelector || '';

            icon.textContent = '💰';
            label.textContent = 'Hızlı Takip Et';
            btn.classList.add('pulse');
            setStatus('✅ Fiyat otomatik algılandı');
        } else {
            icon.textContent = '🎯';
            label.textContent = 'Element Seç ve Takip Et';
            setStatus('Fiyat bulunamadı — Aşağıdan manuel seçici girebilirsin');
            // Auto-show manual selector section
            manualSelectorMode = true;
            document.getElementById('selector-section').style.display = 'flex';
            document.getElementById('toggle-manual').textContent = '⬅️ Otomatik tespite dön';
        }
    });
}

// ─── Track Actions ────────────────────────────────────────────────────────────
async function quickTrack(info) {
    const label = document.getElementById('btn-label');
    label.textContent = 'Kaydediliyor...';
    try {
        const res = await fetch(`${API}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: info.url, domain: info.domain, title: info.title,
                selector_price: info.detectedSelector,
                value_type: 'price'
            })
        });
        const result = await res.json();
        if (result.id) {
            await notifyProductsChanged(result.appended ? 'selector-appended' : 'created', result.id);
            showToast(result.appended ? '✅ Alan mevcut takibe eklendi!' : '✅ Takip kaydedildi!');
            document.getElementById('btn-main').style.display = 'none';
        } else {
            label.textContent = result.error || 'Hata oluştu';
        }
    } catch { label.textContent = '❌ Backend çalışmıyor!'; }
}

async function trackWithSelector() {
    const unifiedInput = (document.getElementById('selector-unified-input')?.value || '').trim();
    if (!unifiedInput) {
        setStatus('⚠️ En az bir CSS seçici gir'); return;
    }
    if (!currentTab) { setStatus('⚠️ Geçerli bir ürün sayfası yok'); return; }

    const parts = splitSelectorInput(unifiedInput);
    const primarySelector = parts[0];
    const secondarySelector = parts.slice(1).join(', ') || null;

    // Test primary selector
    await tryInjectContent(currentTab.id);
    const test = await new Promise(resolve => {
        chrome.tabs.sendMessage(currentTab.id, { action: 'test_selector', selector: primarySelector }, resolve);
    });

    if (!test || !test.found) {
        setStatus(`⚠️ Birinci seçici "${primarySelector}" sayfada eşleşmiyor`);
        return;
    }
    setStatus(`✅ Birinci seçici "${test.value?.substring(0, 25)}" değerini buluyor`);
    const valueType = inferValueType(test.value, test.value_type || 'string');

    try {
        const res = await fetch(`${API}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: currentTab.url,
                domain: new URL(currentTab.url).hostname.replace('www.', '').split('.')[0],
                title: currentTab.title,
                selectors: parts,
                selector_price: primarySelector,
                selector_secondary: secondarySelector,
                value_type: valueType
            })
        });
        const data = await res.json();
        if (data.id) {
            await notifyProductsChanged(data.appended ? 'selector-appended' : 'created', data.id);
            showToast(data.appended ? '✅ Seçici mevcut takibe eklendi!' : '✅ Takip kaydedildi!');
        } else {
            setStatus('❌ ' + (data.error || 'Kayıt hatası'));
        }
    } catch { setStatus('❌ Backend çalışmıyor!'); }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function openWatchlist() {
    chrome.tabs.create({ url: chrome.runtime.getURL('watchlist.html') });
    window.close();
}

function showToast(msg) {
    document.getElementById('toast').style.display = 'flex';
    document.getElementById('toast-msg').textContent = msg;
}

function setStatus(msg) {
    document.getElementById('status-msg').textContent = msg;
}

async function tryInjectContent(tabId) {
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await new Promise(r => setTimeout(r, 200));
    } catch { }
}

function escHTML(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
