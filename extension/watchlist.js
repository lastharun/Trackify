const API = 'http://localhost:3001/api';
let products = [];
let filterState = { tag: 'all', search: '', domainTag: null };
let selectedIds = new Set();
let countdownTimer = null;

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!url.startsWith(API)) return nativeFetch(input, init);

    const stored = await chrome.storage.local.get(['trackify_device_id']);
    const headers = new Headers(init.headers || {});
    if (stored?.trackify_device_id) headers.set('x-trackify-device-id', stored.trackify_device_id);
    return nativeFetch(input, { ...init, headers });
};

function parseSelectorList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    const raw = String(value || '').trim();
    if (!raw) return [];

    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch {
            // Fall through to legacy parsing.
        }
    }

    return raw.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function getTrackedSelectors(product) {
    return [
        String(product?.selector_price || '').trim(),
        ...parseSelectorList(product?.selector_secondary)
    ].filter(Boolean);
}

function renderBlockedOverlay(state) {
    if (!state?.blocked) return;
    if (document.getElementById('trackify-blocked-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'trackify-blocked-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,10,20,0.95);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;';
    overlay.innerHTML = `
        <div style="max-width:560px;background:#17172b;border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:24px;color:#f8fafc;box-shadow:0 20px 50px rgba(0,0,0,0.4)">
            <div style="font-size:22px;font-weight:700;margin-bottom:10px">Trackify bu cihazda devre disi</div>
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
    return state;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.trackify_access_state?.newValue?.blocked) return;
    renderBlockedOverlay(changes.trackify_access_state.newValue);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
function escHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', async () => {
    // Load i18n first
    await loadLanguage();
    await enforceAccessState();

    await loadProducts();

    document.getElementById('refresh-btn').addEventListener('click', async () => {
        const btn = document.getElementById('refresh-btn');
        btn.classList.add('spinning');
        await loadProducts();
        setTimeout(() => btn.classList.remove('spinning'), 600);
    });

    document.getElementById('search-input').addEventListener('input', e => {
        filterState.search = e.target.value.toLowerCase();
        renderProducts();
    });

    document.getElementById('search-input').addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.target.value = '';
            filterState.search = '';
            filterState.domainTag = null;
            refreshDomainTags();
            renderProducts();
        }
    });

    document.getElementById('filter-bar').addEventListener('click', e => {
        const tag = e.target.closest('[data-filter]');
        if (!tag) return;
        filterState.tag = tag.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        renderProducts();
    });

    // Bulk bar buttons
    document.getElementById('bulk-enable').addEventListener('click', bulkEnable);
    document.getElementById('bulk-disable').addEventListener('click', bulkDisable);
    document.getElementById('bulk-delete-btn').addEventListener('click', bulkDelete);
    document.getElementById('bulk-delete-all-btn').addEventListener('click', bulkDeleteAll);
    document.getElementById('bulk-select-all').addEventListener('click', selectAll);
    document.getElementById('bulk-close').addEventListener('click', closeBulkBar);
    document.getElementById('bulk-never-stop').addEventListener('click', () => bulkPatch({ never_stop_on_errors: 1 }));
    document.getElementById('bulk-stop-errors').addEventListener('click', () => bulkPatch({ never_stop_on_errors: 0 }));
    document.getElementById('bulk-clear-history').addEventListener('click', bulkClearHistory);
    document.getElementById('bulk-export').addEventListener('click', exportToFile);

    document.getElementById('bulk-interval').addEventListener('input', e => {
        const next = Math.max(1, Math.min(1440, parseInt(e.target.value || '10', 10) || 10));
        document.getElementById('bulk-interval').value = next;
        document.getElementById('bulk-interval-number').value = next;
        document.getElementById('bulk-interval-val').textContent = formatInterval(next);
    });
    document.getElementById('bulk-interval').addEventListener('change', e => {
        const next = Math.max(1, Math.min(1440, parseInt(e.target.value || '10', 10) || 10));
        bulkPatch({ tracking_interval: next });
    });
    document.getElementById('bulk-interval-number').addEventListener('input', e => {
        const next = Math.max(1, Math.min(1440, parseInt(e.target.value || '10', 10) || 10));
        document.getElementById('bulk-interval').value = next;
        document.getElementById('bulk-interval-number').value = next;
        document.getElementById('bulk-interval-val').textContent = formatInterval(next);
    });
    document.getElementById('bulk-interval-number').addEventListener('change', e => {
        const next = Math.max(1, Math.min(1440, parseInt(e.target.value || '10', 10) || 10));
        bulkPatch({ tracking_interval: next });
    });

    document.getElementById('bulk-wait').addEventListener('input', e => {
        document.getElementById('bulk-wait-val').textContent = e.target.value + 's';
    });
    document.getElementById('bulk-wait').addEventListener('change', e => {
        bulkPatch({ wait_on_page: parseInt(e.target.value) });
    });

    // Event delegation on the product list for all card interactions
    document.getElementById('product-list').addEventListener('click', handleCardClick);
    document.getElementById('product-list').addEventListener('change', handleCardChange);
    document.getElementById('product-list').addEventListener('input', handleCardInput);

    if (!countdownTimer) {
        countdownTimer = setInterval(updateNextCheckCountdowns, 1000);
    }
});

// ─── Event Delegation ─────────────────────────────────────────────────────────
function handleCardClick(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = parseInt(card.dataset.id);

    // Gear/Settings button
    if (e.target.closest('.btn-settings')) {
        e.stopPropagation();
        toggleSettings(id);
        return;
    }

    // Trash/Delete button
    if (e.target.closest('.btn-trash')) {
        e.stopPropagation();
        confirmDelete(id, e.target.closest('.btn-trash'));
        return;
    }

    // Confirm delete button
    if (e.target.closest('.btn-delete-confirm')) {
        e.stopPropagation();
        deleteProduct(id);
        return;
    }

    // Refresh / manual trigger button
    if (e.target.closest('.btn-refresh-card')) {
        e.stopPropagation();
        runProduct(id, e.target.closest('.btn-refresh-card'));
        return;
    }

    // Go to product link
    if (e.target.closest('.btn-go-product')) {
        e.stopPropagation();
        window.open(card.dataset.url, '_blank');
        return;
    }

    // Date badge — expand history
    if (e.target.closest('.date-badge')) {
        e.stopPropagation();
        toggleHistory(id);
        return;
    }

    // Title double-click to edit
    if (e.target.closest('.card-title') && e.detail === 2) {
        startTitleEdit(e.target.closest('.card-title'), id);
        return;
    }

    // Settings value type buttons
    if (e.target.closest('.type-btn')) {
        const btn = e.target.closest('.type-btn');
        btn.closest('.type-btns').querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        patchProduct(id, { value_type: btn.dataset.type });
        return;
    }

    // Notify condition buttons
    if (e.target.closest('.cond-btn')) {
        const btn = e.target.closest('.cond-btn');
        const cond = btn.dataset.cond;
        btn.closest('.cond-btns').querySelectorAll('.cond-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        patchProduct(id, { alert_condition_type: cond });

        // Show/hide value input for conditions that need a value
        const valueRow = card.querySelector('.cond-value-row');
        if (valueRow) {
            const needsInput = ['<', '>', 'includes'].includes(cond);
            valueRow.style.display = needsInput ? 'flex' : 'none';
            const input = valueRow.querySelector('.cond-value-input');
            if (input) {
                input.placeholder = cond === 'includes'
                    ? 'Aranacak kelime... (örn: stokta yok)'
                    : 'Hedef değer... (örn: 500)';
            }
        }
        return;
    }

    // Image picker button
    if (e.target.closest('.btn-pick-img')) {
        e.stopPropagation();
        handlePickImage(id, card.dataset.url);
        return;
    }

    // Advanced settings toggle
    if (e.target.closest('.adv-toggle')) {
        const row = e.target.closest('.adv-row');
        const content = row?.nextElementSibling;
        if (content) {
            const open = content.style.display === 'block';
            content.style.display = open ? 'none' : 'block';
            e.target.closest('.adv-toggle').querySelector('.adv-arrow').textContent = open ? '∨' : '∧';
        }
        return;
    }
}

function handleCardChange(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = parseInt(card.dataset.id);

    // Bulk checkbox
    if (e.target.classList.contains('card-check')) {
        toggleSelect(id, e.target.checked);
        return;
    }

    // Preset dropdown
    if (e.target.classList.contains('preset-selector')) {
        const sel = e.target.value;
        if (sel) {
            const input = card.querySelector('input[data-field="unified_selectors"]');
            if (input) {
                const currentVal = input.value.trim();
                const newVal = currentVal ? `${currentVal}, ${sel}` : sel;
                input.value = newVal;
                const parts = parseSelectorList(newVal);
                patchProduct(id, {
                    selectors: parts,
                    selector_price: parts[0] || null,
                    selector_secondary: parts.slice(1).join(', ') || null
                });
            }
            e.target.value = ''; // Reset dropdown to placeholder
        }
        return;
    }

    // Enable tracking toggle
    if (e.target.dataset.field === 'is_active') {
        patchProduct(id, { is_active: e.target.checked ? 1 : 0 });
        // Update card border color
        card.classList.toggle('is-disabled', !e.target.checked);
        return;
    }

    // Telegram / browser notify toggles
    if (e.target.dataset.field === 'notification_telegram') {
        patchProduct(id, { notification_telegram: e.target.checked ? 1 : 0 });
        return;
    }
    if (e.target.dataset.field === 'notification_browser') {
        patchProduct(id, { notification_browser: e.target.checked ? 1 : 0 });
        return;
    }
    if (e.target.dataset.field === 'never_stop') {
        patchProduct(id, { never_stop: e.target.checked ? 1 : 0 });
        return;
    }

    // Text inputs and ranges saved on change
    if (['selector_price', 'selector_secondary', 'last_image_url', 'tracking_interval', 'wait_on_page', 'alert_condition_value', 'unified_selectors'].includes(e.target.dataset.field)) {
        let val = e.target.value;
        if (['tracking_interval', 'wait_on_page'].includes(e.target.dataset.field)) val = parseInt(val);

        if (e.target.dataset.field === 'unified_selectors') {
            const parts = parseSelectorList(val);
            patchProduct(id, {
                selectors: parts,
                selector_price: parts[0] || null,
                selector_secondary: parts.slice(1).join(', ') || null
            });
        } else {
            patchProduct(id, { [e.target.dataset.field]: val });
        }
        return;
    }
}

function handleCardInput(e) {
    const card = e.target.closest('.card');
    if (!card) return;
    const id = parseInt(card.dataset.id);

    if (e.target.dataset.field === 'tracking_interval') {
        const label = card.querySelector('.iv-label');
        if (label) label.textContent = formatInterval(parseInt(e.target.value));
    }
    if (e.target.dataset.field === 'wait_on_page') {
        const label = card.querySelector('.wait-label');
        if (label) label.textContent = e.target.value + 's';
    }
}

// ─── Load / Render ─────────────────────────────────────────────────────────────
async function loadProducts() {
    try {
        const res = await fetch(`${API}/products?limit=200`);
        const data = await res.json();
        products = data.products || [];
        document.getElementById('total-count').textContent = `${t('wl.total')}: ${data.total || 0}`;
        document.getElementById('total-bulk').textContent = data.total || 0;
        refreshDomainTags();
        renderProducts();
    } catch (e) {
        document.getElementById('product-list').innerHTML =
            `<div class="empty">${t('wl.backend_error')}</div>`;
    }
}

function refreshDomainTags() {
    const bar = document.getElementById('filter-bar');
    bar.querySelectorAll('.domain-tag').forEach(el => el.remove());
    const domains = [...new Set(products.map(p => p.domain).filter(Boolean))];
    domains.forEach(domain => {
        const tag = document.createElement('div');
        tag.className = 'tag domain-tag' + (filterState.domainTag === domain ? ' active' : '');
        tag.dataset.domain = domain;
        tag.textContent = domain;
        tag.addEventListener('click', () => {
            filterState.domainTag = filterState.domainTag === domain ? null : domain;
            refreshDomainTags();
            renderProducts();
        });
        bar.appendChild(tag);
    });
}

function getFiltered() {
    return products.filter(p => {
        const q = filterState.search;
        if (q && !p.title?.toLowerCase().includes(q) && !p.url?.toLowerCase().includes(q) && !p.domain?.toLowerCase().includes(q)) return false;
        if (filterState.domainTag && p.domain !== filterState.domainTag) return false;
        if (filterState.tag === 'on' && !p.is_active) return false;
        if (filterState.tag === 'off' && p.is_active) return false;
        if (filterState.tag === 'errors' && (!p.last_extraction_status || p.last_extraction_status === 'SUCCESS')) return false;
        return true;
    });
}

function renderProducts() {
    const list = document.getElementById('product-list');
    const filtered = getFiltered();
    if (!filtered.length) {
        list.innerHTML = `<div class="empty">${t('wl.empty')}</div>`;
        return;
    }
    list.innerHTML = '';
    filtered.forEach(p => list.appendChild(buildCard(p)));
    updateNextCheckCountdowns();
}

function parseDbDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    const utcIso = raw.includes('T')
        ? (raw.endsWith('Z') ? raw : `${raw}Z`)
        : `${raw.replace(' ', 'T')}Z`;
    const parsedUtc = new Date(utcIso);
    if (!Number.isNaN(parsedUtc.getTime())) return parsedUtc;

    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function getNextCheckDate(product) {
    if (!product?.is_active) return null;

    const explicitNextCheck = parseDbDate(product.next_check_at);
    if (explicitNextCheck) return explicitNextCheck;

    const lastCheckedAt = parseDbDate(product.last_checked_at);
    const trackingMinutes = Math.max(1, parseInt(product?.tracking_interval || '10', 10) || 10);
    if (!lastCheckedAt) return null;

    return new Date(lastCheckedAt.getTime() + (trackingMinutes * 60 * 1000));
}

function formatRemaining(ms) {
    if (ms <= 0) return 'Hazır';

    const totalSeconds = Math.ceil(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}sa ${String(minutes).padStart(2, '0')}dk ${String(seconds).padStart(2, '0')}sn`;
    }
    if (minutes > 0) {
        return `${minutes}dk ${String(seconds).padStart(2, '0')}sn`;
    }
    return `${seconds}sn`;
}

function updateNextCheckCountdowns() {
    document.querySelectorAll('.next-check-badge').forEach((node) => {
        const productId = parseInt(node.dataset.productId || '0', 10);
        const product = products.find((item) => item.id === productId);
        if (!product) return;

        if (!product.is_active) {
            node.textContent = 'Pasif';
            node.title = 'Takip kapalı';
            return;
        }

        const nextCheckDate = getNextCheckDate(product);
        if (!nextCheckDate) {
            node.textContent = 'Planlanıyor';
            node.title = 'Henüz sonraki tarama zamanı hesaplanamadı';
            return;
        }

        const remaining = nextCheckDate.getTime() - Date.now();
        node.textContent = formatRemaining(remaining);
        node.title = `Sonraki tarama: ${formatDateTime(nextCheckDate.toISOString())}`;
        node.classList.toggle('is-due', remaining <= 0);
    });
}

// ─── Card Builder ─────────────────────────────────────────────────────────────
function buildCard(p) {
    const isError = p.last_extraction_status && p.last_extraction_status !== 'SUCCESS';
    const isDisabled = !p.is_active;
    const checkedAt = parseDbDate(p.last_checked_at);
    const price = p.last_price;
    const vtype = p.value_type || 'price';
    const cond = p.alert_condition_type || 'all';
    const nextCheckDate = getNextCheckDate(p);
    const nextCheckLabel = !p.is_active
        ? 'Pasif'
        : !nextCheckDate
            ? 'Planlanıyor'
            : formatRemaining(nextCheckDate.getTime() - Date.now());

    const card = document.createElement('div');
    card.className = 'card' + (isError ? ' has-error' : '') + (isDisabled ? ' is-disabled' : '');
    card.dataset.id = p.id;
    card.dataset.url = p.url || '';

    card.innerHTML = `
    <div class="card-main">
        <div class="card-left">
            <input type="checkbox" class="card-check" ${selectedIds.has(p.id) ? 'checked' : ''}>
        </div>
        <img class="card-img" src="${p.last_image_url || ''}" onerror="this.style.display='none'" alt="">
        <div class="card-body">
            <div class="card-domain">
                <img src="https://www.google.com/s2/favicons?domain=${p.domain}.com" width="14" onerror="this.style.display='none'">
                <a href="${p.url}" target="_blank" style="color:inherit; text-decoration:none; display:flex; align-items:center; gap:4px">
                    <span>${p.domain || ''}</span>
                    <span style="font-size:10px; opacity:0.5">↗</span>
                </a>
            </div>
            <div class="card-title" title="Double-click to edit">${p.title || 'Untitled'}</div>
            <div class="card-meta">
                <span class="date-badge ${isError ? 'error' : isDisabled ? 'old' : ''}"
                    title="${isError ? (p.last_failure_reason || 'Error') : 'Click to view history'}">${checkedAt ? formatDate(checkedAt) : '—'}</span>
                <span class="next-check-badge" data-product-id="${p.id}" title="${nextCheckDate ? `Sonraki tarama: ${formatDateTime(nextCheckDate.toISOString())}` : 'Henüz sonraki tarama zamanı hesaplanamadı'}">${nextCheckLabel}</span>
                ${p.last_failure_reason === 'PRICE_ERROR' ? '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700">ELEMENT YOK</span>' : ''}
                <span class="price-val">${formatCurrentVal(p)}</span>
            </div>
        </div>
        <div class="card-actions">
            <button class="icon-btn btn-settings" title="Settings">⚙️</button>
            <button class="icon-btn btn-trash" title="Delete">🗑️</button>
            <button class="btn-delete-confirm" style="display:none">delete</button>
        </div>
        <div class="card-actions-right">
            <button class="icon-btn btn-go-product" title="Ürüne Git">🔗</button>
            <button class="icon-btn btn-refresh-card" title="Run now">↻</button>
        </div>
    </div>

    <!-- History Rows -->
    <div class="history-rows" id="history-${p.id}" style="display:none"></div>

    <!-- Settings Panel -->
    <div class="card-settings" id="settings-${p.id}" style="display:none">
        <div class="settings-section">
            <b>Settings:</b>
            <div class="settings-row" style="margin-top:10px">
                <div class="settings-left">
                    <label class="toggle-row">
                        <label class="toggle">
                            <input type="checkbox" data-field="is_active" ${p.is_active ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <span>Enable Tracking</span>
                    </label>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <span>Tracking Interval: <span class="iv-label" style="color:var(--primary);font-weight:700">${formatInterval(p.tracking_interval || 10)}</span></span>
                    <div style="display:flex;gap:8px;align-items:center">
                        <input type="range" min="1" max="1440" value="${p.tracking_interval || 10}" data-field="tracking_interval"
                            onchange="patchProduct(${p.id}, {tracking_interval: parseInt(this.value)})" style="accent-color:var(--primary);width:160px">
                        <input type="number" min="1" max="1440" value="${p.tracking_interval || 10}" style="width:80px"
                            oninput="this.previousElementSibling.value=this.value; this.parentElement.previousElementSibling.querySelector('.iv-label').textContent=formatInterval(parseInt(this.value||10))"
                            onchange="patchProduct(${p.id}, {tracking_interval: parseInt(this.value||10)})">
                    </div>
                </div>
            </div>
            <div class="settings-row" style="margin-top:10px">
                <span>Değer tipi:</span>
                <div class="type-btns">
                    <button class="type-btn ${vtype === 'price' ? 'active' : ''}" data-type="price">💰 Fiyat</button>
                    <button class="type-btn ${vtype === 'number' ? 'active' : ''}" data-type="number">🔢 Sayı</button>
                    <button class="type-btn ${vtype === 'string' ? 'active' : ''}" data-type="string">🔤 Metin/Alan</button>
                </div>
            </div>
        </div>

        <div class="settings-section" style="margin-top:14px">
            <b>Notifications:</b>
            <div class="settings-row" style="margin-top:10px;gap:20px;align-items:center">
                <label class="toggle-row">
                    <label class="toggle">
                        <input type="checkbox" data-field="notification_telegram" ${p.notification_telegram ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span>Telegram</span>
                </label>
                <label class="toggle-row">
                    <label class="toggle">
                        <input type="checkbox" data-field="notification_browser" ${p.notification_browser ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span>Browser</span>
                </label>
            </div>
            <div class="settings-row" style="margin-top:10px;flex-wrap:wrap;gap:6px">
                <span style="flex-basis:100%;font-size:12px;font-weight:600">Bildir:</span>
                <div class="cond-btns">
                    ${(vtype === 'string'
            ? [
                { c: 'all', label: 'Her değişimde' },
                { c: 'includes', label: '🔤 Şunu içerirse...' },
            ]
            : [
                { c: 'all', label: 'Her değişimde' },
                { c: '↓', label: '📉 Düşünce' },
                { c: '↑', label: '📈 Artınca' },
                { c: '<', label: '< Küçükse' },
                { c: '>', label: '> Büyükse' },
            ]
        ).map(({ c, label }) =>
            `<button class="cond-btn ${cond === c ? 'active' : ''}" data-cond="${c}">${label}</button>`
        ).join('')}
                </div>
                <div class="cond-value-row" style="display:${['<', '>', 'includes'].includes(cond) ? 'flex' : 'none'};align-items:center;gap:6px;margin-top:6px;flex-basis:100%">
                    <input type="text" class="cond-value-input" 
                        value="${escHTML(p.alert_condition_value || '')}"
                        placeholder="${cond === 'includes' ? 'Aranacak kelime... (örn: stokta yok)' : 'Hedef fiyat... (örn: 500)'}"
                        style="flex:1;background:rgba(0,0,0,0.2);border:1px solid var(--primary);border-radius:6px;padding:5px 10px;color:#fff;font-size:12px;outline:none"
                        data-field="alert_condition_value">
                </div>
            </div>
        </div>

        <div class="adv-row" style="margin-top:14px">
            <div class="adv-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:600">
                Takip Edilen Alanlar (CSS): <span class="adv-arrow">∨</span>
            </div>
        </div>
        <div style="display:none;margin-top:12px">
            
            <div class="settings-row" style="margin-bottom:8px">
                <div style="flex:1;display:flex;flex-direction:column;gap:6px">
                    <div style="font-size:11px;color:#94a3b8;line-height:1.2;margin-bottom:4px">
                        <b>İpucu:</b> Birden fazla alanı virgülle veya alt alta ekleyebilirsin. İlk alan kartın ön yüzünde görünür.
                    </div>
                    <input type="text" value="${escHTML([p.selector_price, ...parseSelectorList(p.selector_secondary)].filter(Boolean).join(', '))}" 
                        data-field="unified_selectors" 
                        placeholder="#price, .stock-status, .seller-name"
                        style="width:100%;background:rgba(0,0,0,0.2);border:1px solid var(--primary);border-radius:6px;padding:8px 10px;color:#fff;font-family:monospace;font-size:12px;outline:none">
                    
                    <select class="preset-selector" style="width:100%;background:#1e293b;color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:6px;font-size:11px;outline:none;cursor:pointer">
                        <option value="">-- Hazır Seçiciler (Tıkla Ekle) --</option>
                        <optgroup label="Amazon">
                            <option value="#availability">Amazon: Stok Durumu</option>
                            <option value="#merchant-info">Amazon: Satıcı Adı</option>
                            <option value="#price-shipping-message">Amazon: Kargo Bilgisi</option>
                        </optgroup>
                        <optgroup label="Trendyol">
                            <option value="[class*='stock']">Trendyol: Stok</option>
                            <option value="[class*='seller-name']">Trendyol: Satıcı Adı</option>
                        </optgroup>
                        <optgroup label="Hepsiburada">
                            <option value="[data-test-id='stock']">Hepsiburada: Stok</option>
                            <option value="[data-test-id='merchantName']">Hepsiburada: Satıcı Adı</option>
                        </optgroup>
                    </select>
                </div>
            </div>

            <div class="settings-row" style="margin-bottom:12px;margin-top:12px">
                <span style="width:100px;font-size:12px" data-i18n="card.image_url">${t('card.image_url')}</span>
                <div style="flex:1;display:flex;gap:4px">
                    <input type="text" value="${p.last_image_url || ''}" data-field="last_image_url" 
                        placeholder="https://..."
                        style="flex:1;background:rgba(0,0,0,0.2);border:1px solid var(--primary);border-radius:6px;padding:6px 10px;color:#fff;font-size:11px;outline:none">
                    <button class="icon-btn btn-pick-img" title="Sayfadan Seç" style="padding:4px;font-size:14px">🎯</button>
                </div>
            </div>
            <div class="settings-row">
                <span style="font-size:12px"><span data-i18n="card.wait_on_page">${t('card.wait_on_page')}</span> <span class="wait-label" style="color:var(--primary);font-weight:700">${p.wait_on_page || 4}s</span></span>
                <input type="range" min="1" max="30" value="${p.wait_on_page || 4}" data-field="wait_on_page"
                    style="accent-color:var(--primary);flex:1;max-width:200px">
            </div>
            <div class="settings-row" style="margin-top:10px">
                <label class="toggle-row">
                    <label class="toggle">
                        <input type="checkbox" data-field="never_stop" ${p.never_stop ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span style="font-size:12px">Never stop on errors</span>
                </label>
            </div>
        </div>
    </div>
    `;

    return card;
}

function formatCurrentVal(p) {
    const vtype = p.value_type || 'price';
    const val = String(p.last_value ?? '');

    if (vtype === 'string') {
        return val.length > 80 ? val.substring(0, 80) + '...' : (val || '—');
    }

    if (vtype === 'number') {
        if (val) return val.length > 80 ? val.substring(0, 80) + '...' : val;
        if (p.last_price !== null && p.last_price !== undefined) return p.last_price.toLocaleString('tr-TR');
        return '—';
    }

    if (p.last_price !== null && p.last_price !== undefined) return p.last_price.toLocaleString('tr-TR') + ' TRY';
    if (val) return val.length > 80 ? val.substring(0, 80) + '...' : val;
    return '—';
}

// ─── Card Actions ─────────────────────────────────────────────────────────────
function toggleSettings(id) {
    const el = document.getElementById(`settings-${id}`);
    if (!el) return;
    const isOpen = el.style.display === 'block';
    // Close all others
    document.querySelectorAll('.card-settings').forEach(s => s.style.display = 'none');
    el.style.display = isOpen ? 'none' : 'block';
}

async function toggleHistory(id) {
    const el = document.getElementById(`history-${id}`);
    if (!el) return;
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = `<div style="padding:8px;color:var(--muted);font-size:12px">${t('wl.loading')}</div>`;
    try {
        const res = await fetch(`${API}/products/${id}/changes`);
        const rows = await res.json();
        const product = products.find(p => p.id === id);
        const trackedSelectors = getTrackedSelectors(product);

        const parseDetails = (row) => {
            try {
                const parsed = row.details_json ? JSON.parse(row.details_json) : {};
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        };

        const fallbackSelectorMeta = (row) => {
            const allSelectors = trackedSelectors;
            const selector = String(row.field_changed || '').trim();
            const cssIndex = selector ? allSelectors.indexOf(selector) + 1 : 0;
            return {
                selector: selector && !['last_value', 'selector_secondary', 'price', 'is_in_stock'].includes(selector) ? selector : null,
                css_index: cssIndex > 0 ? cssIndex : null
            };
        };

        const selectorsWithHistory = new Set(
            rows.map((row) => {
                const details = { ...fallbackSelectorMeta(row), ...parseDetails(row) };
                return String(details.selector || '').trim();
            }).filter(Boolean)
        );

        const trackedSelectorsHtml = trackedSelectors.length
            ? `
                <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02)">
                    <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:600">Aktif takip edilen CSS alanları</div>
                    <div style="display:flex;flex-direction:column;gap:6px">
                        ${trackedSelectors.map((selector, index) => `
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                                <span style="background:rgba(59,130,246,0.18); color:#93c5fd; padding:2px 6px; border-radius:999px; font-size:10px">CSS #${index + 1}</span>
                                <span style="background:rgba(255,255,255,0.08); color:#e2e8f0; padding:2px 8px; border-radius:999px; font-size:10px; max-width:100%; overflow:hidden; text-overflow:ellipsis">${escHTML(selector)}</span>
                                <span style="font-size:10px; color:${selectorsWithHistory.has(selector) ? '#34d399' : '#94a3b8'}">${selectorsWithHistory.has(selector) ? 'Geçmişte kayıt var' : 'Henüz değişim kaydı yok'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `
            : '';

        const changeRowsHtml = rows.length ? rows.slice(0, 15).map((r) => `
            ${(() => {
                const details = { ...fallbackSelectorMeta(r), ...parseDetails(r) };
                const badges = [];
                if (details.css_index) badges.push(`<span style="background:rgba(59,130,246,0.18); color:#93c5fd; padding:2px 6px; border-radius:999px">CSS #${details.css_index}</span>`);
                if (details.selector) badges.push(`<span style="background:rgba(255,255,255,0.08); color:#cbd5e1; padding:2px 6px; border-radius:999px; max-width:100%; overflow:hidden; text-overflow:ellipsis">${escHTML(details.selector)}</span>`);
                return `
            <div class="history-row" style="flex-direction:column; align-items:flex-start; height:auto; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.05)">
                <div style="display:flex; justify-content:space-between; width:100%; font-size:10px; color:var(--muted); margin-bottom:4px">
                    <span>${formatDateTime(r.timestamp)}</span>
                    <span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px">${r.change_type}</span>
                </div>
                ${badges.length ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; font-size:10px">${badges.join('')}</div>` : ''}
                <div style="font-size:12px; color:#fff; word-break:break-all">
                    ${r.old_value && r.old_value !== 'null' ? `<strike style="color:#ef4444; opacity:0.7">${escHTML(r.old_value)}</strike> ➜ ` : ''}
                    <span style="color:#10b981">${escHTML(r.new_value)}</span>
                </div>
            </div>
        `;
            })()}
        `).join('') : `<div style="padding:10px 12px;color:var(--muted);font-size:12px">${t('card.history_none')}</div>`;

        el.innerHTML = `${trackedSelectorsHtml}${changeRowsHtml}`;
    } catch { el.innerHTML = `<div style="padding:6px;color:var(--muted);font-size:12px">${t('card.history_fail')}</div>`; }
}

let deleteTimers = {};
function confirmDelete(id, btn) {
    const confirmBtn = btn.closest('.card').querySelector('.btn-delete-confirm');
    if (!confirmBtn) return;
    const isShowing = confirmBtn.style.display === 'inline-block';
    // Hide all confirm buttons
    document.querySelectorAll('.btn-delete-confirm').forEach(b => b.style.display = 'none');
    if (!isShowing) {
        confirmBtn.style.display = 'inline-block';
        clearTimeout(deleteTimers[id]);
        deleteTimers[id] = setTimeout(() => { confirmBtn.style.display = 'none'; }, 4000);
    }
}

async function deleteProduct(id) {
    try {
        await fetch(`${API}/products/${id}`, { method: 'DELETE' });
        products = products.filter(p => p.id !== id);
        selectedIds.delete(id);
        renderProducts();
        updateBulkBar();
    } catch (e) { console.error(e); }
}

async function runProduct(id, btn) {
    btn.classList.add('spinning');
    try {
        await new Promise(resolve => {
            try {
                chrome.runtime.sendMessage({ action: 'run_now', productId: id }, () => resolve(null));
            } catch {
                resolve(null);
            }
        });
        setTimeout(() => { btn.classList.remove('spinning'); loadProducts(); }, 1200);
    } catch { btn.classList.remove('spinning'); }
}

function startTitleEdit(el, id) {
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    const save = () => {
        el.contentEditable = 'false';
        patchProduct(id, { title: el.textContent.trim() });
        el.removeEventListener('blur', save);
    };
    el.addEventListener('blur', save);
    el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
}

// ─── Patch & Select ───────────────────────────────────────────────────────────
async function patchProduct(id, updates) {
    try {
        await fetch(`${API}/products/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        const p = products.find(x => x.id === id);
        if (p) Object.assign(p, updates);
        updateNextCheckCountdowns();
    } catch (e) { console.error('Patch failed:', e); }
}

function toggleSelect(id, checked) {
    if (checked) selectedIds.add(id); else selectedIds.delete(id);
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = selectedIds.size;
    document.getElementById('selected-count').textContent = count;
    bar.style.display = count > 0 ? 'flex' : 'none';
}

// ─── Bulk Actions ─────────────────────────────────────────────────────────────
function selectAll() {
    const filtered = getFiltered();
    if (selectedIds.size === filtered.length) {
        // Deselect all
        selectedIds.clear();
        document.querySelectorAll('.card-check').forEach(c => c.checked = false);
    } else {
        filtered.forEach(p => selectedIds.add(p.id));
        document.querySelectorAll('.card-check').forEach(c => {
            const id = parseInt(c.closest('.card').dataset.id);
            c.checked = selectedIds.has(id);
        });
    }
    updateBulkBar();
}

function closeBulkBar() {
    selectedIds.clear();
    document.querySelectorAll('.card-check').forEach(c => c.checked = false);
    updateBulkBar();
}

async function bulkPatch(updates) {
    for (const id of selectedIds) await patchProduct(id, updates);
    renderProducts();
}

async function bulkEnable() { await bulkPatch({ is_active: 1 }); }
async function bulkDisable() { await bulkPatch({ is_active: 0 }); }

async function bulkDelete() {
    if (!confirm(`${selectedIds.size} takibi silmek istediğinize emin misiniz?`)) return;
    for (const id of [...selectedIds]) await deleteProduct(id);
    closeBulkBar();
}

async function bulkDeleteAll() {
    if (!products.length) return;
    if (!confirm(`Tüm ${products.length} takibi silmek istediğinize emin misiniz?`)) return;
    for (const product of [...products]) await deleteProduct(product.id);
    closeBulkBar();
}

async function bulkClearHistory() {
    if (!confirm('Seçili ürünlerin geçmişi silinecek. Onaylıyor musunuz?')) return;
    for (const id of selectedIds) {
        await fetch(`${API}/products/${id}/history`, { method: 'DELETE' }).catch(() => { });
    }
    await loadProducts();
}

function exportToFile() {
    const filtered = products.filter(p => selectedIds.has(p.id));
    const csv = ['URL,Domain,Title,Last Price,Last Checked,Is Active']
        .concat(filtered.map(p => `"${p.url}","${p.domain}","${p.title || ''}","${p.last_price || ''}","${p.last_checked_at || ''}","${p.is_active}"`))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'price-tracker-export.csv';
    a.click(); URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(date) {
    return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value) {
    const parsed = parseDbDate(value);
    if (!parsed) return '—';
    return parsed.toLocaleString('tr-TR');
}

async function handlePickImage(id, url) {
    if (!url) return;
    const tabs = await chrome.tabs.query({ url: url + '*' });
    let tab = tabs[0];
    if (!tab) tab = await chrome.tabs.create({ url, active: true });
    else await chrome.tabs.update(tab.id, { active: true });

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    chrome.tabs.sendMessage(tab.id, { action: 'start_selection', type: 'image', productId: id });
}

function formatInterval(minutes) {
    if (!minutes) return '—';
    const h = Math.floor(minutes / 60), m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Expose patchProduct globally for onchange on sliders embedded in card HTML
window.patchProduct = patchProduct;
