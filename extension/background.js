/**
 * Price Tracker — Background Service Worker
 *
 * For extension-tracked products (those with selector_price set):
 * - Opens the product URL in a background tab
 * - Reads the element value using the CSS selector
 * - Syncs to backend via POST /api/extension/sync
 * - Backend compares with previous value and triggers notification if changed
 * - Works for ANY element (price, stock status, text, etc.)
 * - If element is empty/not found: still syncs with empty + marks as "waiting"
 */

const API = 'http://localhost:3001/api';
const POLL_INTERVAL_MS = 15000; // Faster poll for quicker refresh
const MIN_WAIT_MS = 1200;
const MAX_WAIT_MS = 30000;
const SELECTOR_WAIT_TIMEOUT_MS = 8000;
const SELECTOR_POLL_MS = 300;
const SCANNER_IDLE_PARK_MS = 60000;
const MAX_SCANNER_TABS = 2;
const DEVICE_ID_KEY = 'trackify_device_id';
const ACCESS_STATE_KEY = 'trackify_access_state';
const PRODUCTS_REVISION_KEY = 'trackify_products_revision';
const ACCESS_REFRESH_ALARM = 'trackify-access-refresh';
const ACCESS_REFRESH_MINUTES = 1;

let deviceIdCache = null;
let accessStateCache = { status: 'active', blocked: false, reason: null, blocked_until: null };

async function notifyProductsChanged(reason, productId) {
    await chrome.storage.local.set({
        [PRODUCTS_REVISION_KEY]: {
            reason: String(reason || 'updated'),
            productId: productId || null,
            at: Date.now()
        }
    });
}

function parseSelectorList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (!value) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch { }
    }
    return raw.split(/\r?\n|,/).map((part) => part.trim()).filter(Boolean);
}

function normalizeExtractedText(value) {
    return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function ensureDeviceId() {
    try {
        const manifest = chrome.runtime.getManifest();
        const res = await fetch(`${API}/device/bootstrap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                device_name: `Trackify ${navigator.platform || 'unknown'}`,
                platform: navigator.platform || 'unknown',
                user_agent: navigator.userAgent || '',
                extension_version: manifest.version || 'unknown'
            })
        });
        if (res.ok) {
            const data = await res.json();
            if (data?.device_id) {
                deviceIdCache = data.device_id;
                await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceIdCache });
                return deviceIdCache;
            }
        }
    } catch { }

    deviceIdCache = null;
    await chrome.storage.local.remove([DEVICE_ID_KEY]);
    throw new Error('Trackify masaüstü uygulaması açık değil.');
}

async function setAccessState(nextState) {
    const previousBlocked = Boolean(accessStateCache?.blocked);
    accessStateCache = {
        status: nextState?.status || 'active',
        blocked: Boolean(nextState?.blocked),
        reason: nextState?.reason || null,
        blocked_until: nextState?.blocked_until || null,
        checked_at: new Date().toISOString()
    };
    await chrome.storage.local.set({ [ACCESS_STATE_KEY]: accessStateCache });
    await chrome.action.setBadgeText({ text: accessStateCache.blocked ? '!' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: accessStateCache.blocked ? '#dc2626' : '#16a34a' });

    if (accessStateCache.blocked && !previousBlocked) {
        try {
            await chrome.notifications.create(`access_blocked_${Date.now()}`, {
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Trackify erişimi durduruldu',
                message: accessStateCache.reason || 'Bu cihaz developer tarafından engellendi.'
            });
        } catch { }
    }

    if (!accessStateCache.blocked && previousBlocked) {
        try {
            await chrome.notifications.create(`access_restored_${Date.now()}`, {
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'Trackify erişimi açıldı',
                message: 'Bu cihaz tekrar aktif duruma geçti.'
            });
        } catch { }
    }

    return accessStateCache;
}

async function getAccessState() {
    if (accessStateCache?.status) return accessStateCache;
    const stored = await chrome.storage.local.get([ACCESS_STATE_KEY]);
    accessStateCache = stored?.[ACCESS_STATE_KEY] || accessStateCache;
    return accessStateCache;
}

async function isDeviceBlocked() {
    const state = await getAccessState();
    return Boolean(state?.blocked);
}

async function apiFetch(path, init = {}) {
    const deviceId = await ensureDeviceId();
    const headers = new Headers(init.headers || {});
    headers.set('x-trackify-device-id', deviceId);
    return fetch(`${API}${path}`, { ...init, headers });
}

async function refreshDeviceAccess(mode = 'heartbeat') {
    try {
        const deviceId = await ensureDeviceId();
        const res = await fetch(`${API}/device/status?device_id=${encodeURIComponent(deviceId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return await setAccessState({
            status: data?.status || 'active',
            blocked: Boolean(data?.blocked),
            reason: data?.reason || null,
            blocked_until: data?.blocked_until || null
        });
    } catch (e) {
        console.error('[PT] Device access error:', e.message);
        const previousState = await getAccessState();
        const localAppMissing = /masaüstü uygulaması/i.test(String(e?.message || ''));
        return await setAccessState({
            status: localAppMissing ? 'local_app_required' : (previousState?.status || 'unknown'),
            blocked: localAppMissing ? true : Boolean(previousState?.blocked),
            reason: localAppMissing ? String(e.message) : (previousState?.reason || null),
            blocked_until: localAppMissing ? null : (previousState?.blocked_until || null)
        });
    }
}

async function refreshAccessAndPropagate(mode = 'heartbeat') {
    const state = await refreshDeviceAccess(mode);
    chrome.storage.local.set({
        status: state?.blocked ? 'blocked' : 'connected',
        lastAccessCheck: Date.now()
    });
    return state;
}

// ─── Task Polling Loop ────────────────────────────────────────────────────────
const scanQueue = [];
const queuedTaskIds = new Set();
let isProcessingQueue = false;

async function pollTasks() {
    try {
        if (await isDeviceBlocked()) {
            chrome.storage.local.set({ status: 'blocked', lastPoll: Date.now() });
            return;
        }

        const res = await apiFetch('/extension/tasks');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tasks = await res.json();
        if (!tasks.length) { chrome.storage.local.set({ status: 'connected', lastPoll: Date.now() }); return; }
        console.log(`[PriceTracker] ${tasks.length} tasks to process`);
        chrome.storage.local.set({ status: 'checking', lastPoll: Date.now() });
        enqueueTasks(tasks);
    } catch (e) {
        console.error('[PriceTracker] Poll error:', e.message);
        chrome.storage.local.set({ status: 'disconnected' });
    }
}

// ─── Persistent Scanner Tab Management ─────────────────────────────────────────
const scannerSlots = Array.from({ length: MAX_SCANNER_TABS }, () => ({
    tabId: null,
    parkTimer: null
}));

function clearScannerParkTimer(slot) {
    if (slot.parkTimer) {
        clearTimeout(slot.parkTimer);
        slot.parkTimer = null;
    }
}

function scheduleScannerParking(slot) {
    clearScannerParkTimer(slot);
    if (slot.tabId === null) return;
    slot.parkTimer = setTimeout(async () => {
        try {
            await chrome.tabs.update(slot.tabId, { url: 'about:blank', active: false, muted: true });
        } catch { }
    }, SCANNER_IDLE_PARK_MS);
}

async function getScannerTab(slotIndex) {
    const slot = scannerSlots[slotIndex];
    clearScannerParkTimer(slot);

    if (slot.tabId !== null) {
        try {
            const tab = await chrome.tabs.get(slot.tabId);
            try {
                await chrome.tabs.update(slot.tabId, { pinned: true, active: false, muted: true, autoDiscardable: false });
            } catch { }
            return tab.id;
        } catch {
            slot.tabId = null;
        }
    }

    let windowId = null;
    try {
        const win = await chrome.windows.getLastFocused({ populate: false });
        windowId = win?.id ?? null;
    } catch { }

    const tab = await chrome.tabs.create({
        windowId: windowId ?? undefined,
        url: 'about:blank',
        active: false,
        pinned: true
    });
    slot.tabId = tab.id;
    try { await chrome.tabs.update(slot.tabId, { muted: true, pinned: true, active: false, autoDiscardable: false }); } catch { }
    return slot.tabId;
}

function enqueueTasks(tasks) {
    for (const task of tasks || []) {
        if (!task?.id) continue;
        if (queuedTaskIds.has(task.id)) continue;
        queuedTaskIds.add(task.id);
        scanQueue.push(task);
    }
    if (!isProcessingQueue) {
        processQueue().catch(e => console.error('[PT] Queue error:', e));
    }
}

async function processQueue() {
    if (isProcessingQueue) return;
    if (await isDeviceBlocked()) {
        chrome.storage.local.set({ status: 'blocked' });
        return;
    }
    isProcessingQueue = true;
    chrome.storage.local.set({ status: 'checking' });

    const workerCount = Math.max(1, Math.min(MAX_SCANNER_TABS, scanQueue.length || 1));
    await Promise.all(
        Array.from({ length: workerCount }, (_, slotIndex) => consumeQueue(slotIndex))
    );

    isProcessingQueue = false;
    chrome.storage.local.set({ status: 'connected' });
    for (const slot of scannerSlots) {
        scheduleScannerParking(slot);
    }
    if (scanQueue.length > 0) {
        processQueue().catch(e => console.error('[PT] Queue restart error:', e));
    }
}

async function consumeQueue(slotIndex) {
    const tabId = await getScannerTab(slotIndex);

    while (true) {
        const task = scanQueue.shift();
        if (!task) break;
        try {
            await processTask(task, tabId).catch(e => console.error('[PT] Task failed:', e));
        } finally {
            queuedTaskIds.delete(task?.id);
        }
    }
}

async function fetchTaskById(productId) {
    try {
        const res = await apiFetch(`/extension/tasks/${productId}`);
        if (!res.ok) {
            const listRes = await apiFetch('/extension/tasks');
            if (!listRes.ok) return null;
            const tasks = await listRes.json();
            return Array.isArray(tasks) ? tasks.find((task) => Number(task?.id) === Number(productId)) || null : null;
        }
        return await res.json();
    } catch {
        return null;
    }
}

// ─── Process a Single Task ────────────────────────────────────────────────────

async function processTask(task, forcedTabId = null) {
    if (await isDeviceBlocked()) return;
    const tabId = forcedTabId || await getScannerTab(0);
    console.log(`[PT] Processing in dedicated tab #${tabId}: ${task.url}`);

    try {
        await chrome.tabs.update(tabId, { url: task.url });
        await waitForTab(tabId);

        const configuredWaitMs = Number.isFinite(Number(task.wait_on_page))
            ? Number(task.wait_on_page) * 1000
            : 2000;
        const waitMs = Math.max(MIN_WAIT_MS, Math.min(MAX_WAIT_MS, configuredWaitMs));
        await sleep(waitMs);

        try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            await sleep(120);
        } catch { }

        if (task.selector_price) {
            const selectorTimeout = Math.max(
                SELECTOR_WAIT_TIMEOUT_MS,
                Math.min(MAX_WAIT_MS, waitMs + 5000)
            );
            await waitForSelectorText(tabId, task.selector_price, selectorTimeout);
        }

        // ── Extract price element ────────────────────────────────────────────────
        const result = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, {
                action: 'extract_element',
                selector: task.selector_price,
                selectorTitle: task.selector_title,
                selectorImage: task.selector_image,
                expectPrice: task.value_type === 'price'
            }, (r) => {
                if (chrome.runtime.lastError) { resolve(null); }
                else { resolve(r); }
            });
        });

        // ── Extract secondary element ────────────────────────────────────────────
        let secondaryValue = null;
        let secondaryItems = [];
        if (task.selector_secondary) {
            const secs = parseSelectorList(task.selector_secondary);
            const secondaryTexts = [];
            for (const sel of secs) {
                await waitForSelectorText(tabId, sel, 4000);
                const secResult = await new Promise((resolve) => {
                    chrome.tabs.sendMessage(tabId, {
                        action: 'extract_element',
                        selector: sel,
                        selectorTitle: null,
                        selectorImage: null,
                        expectPrice: false
                    }, (r) => {
                        if (chrome.runtime.lastError) resolve(null);
                        else resolve(r);
                    });
                });
                const cleanSecondaryValue = normalizeExtractedText(secResult?.value);
                secondaryItems.push({
                    selector: sel,
                    value: cleanSecondaryValue,
                    elementFound: Boolean(secResult?.elementFound)
                });
                if (cleanSecondaryValue) secondaryTexts.push(cleanSecondaryValue);
            }
            secondaryValue = secondaryTexts.join(' ') || '';
        }

        if (result === null) {
            await syncResult({ productId: task.id, status: 'CONTENT_SCRIPT_ERROR', url: task.url });
        } else {
            const priceNotFound = task.value_type === 'price' && task.selector_price && !result.elementFound;
            const cleanValue = normalizeExtractedText(result.value);
            const cleanSecondary = normalizeExtractedText(secondaryValue);

            await syncResult({
                productId: task.id,
                url: task.url,
                value: cleanValue,
                price: result.price || null,
                price_not_found: priceNotFound,
                secondary_value: cleanSecondary,
                secondary_items: secondaryItems,
                title: result.title,
                image: result.image,
                elementFound: result.elementFound,
                status: 'SUCCESS'
            });
        }
    } catch (err) {
        console.error('[PT] Process task error:', err);
    }
}

// ─── Sync Result to Backend ───────────────────────────────────────────────────

async function syncResult(data) {
    try {
        if (await isDeviceBlocked()) return { success: false, blocked: true };
        const res = await apiFetch('/extension/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const json = await res.json();
        if (json.success) {
            chrome.storage.local.set({ lastSync: Date.now() });
            await notifyProductsChanged(json.changed ? 'synced_changed' : 'synced', data.productId);
            // Show browser notification for each notification message
            if (json.changed && json.notifications && json.notifications.length > 0) {
                json.notifications.forEach((notif, i) => {
                    // Strip HTML for browser notification
                    const plain = notif.replace(/<[^>]+>/g, '').substring(0, 200);
                    chrome.notifications.create(`notif_${Date.now()}_${i}`, {
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: '🔔 Trackify Takip - Değişiklik!',
                        message: plain
                    });
                });
            }
        }
        return json;
    } catch (e) {
        console.error('[PT] Sync error:', e.message);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function waitForTab(tabId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => resolve(), 60000); // don't hang forever
        const poll = setInterval(async () => {
            try {
                const t = await chrome.tabs.get(tabId);
                if (t.status === 'complete') {
                    clearTimeout(timeout);
                    clearInterval(poll);
                    resolve();
                }
            } catch { clearTimeout(timeout); clearInterval(poll); resolve(); }
        }, 250);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function selectorHasText(tabId, selector) {
    if (!selector) return false;
    try {
        const [result] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (sel) => {
                try {
                    return Array.from(document.querySelectorAll(sel)).some((el) => {
                        const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return raw.length > 0;
                    });
                } catch {
                    return false;
                }
            },
            args: [selector]
        });
        return Boolean(result?.result);
    } catch {
        return false;
    }
}

async function waitForSelectorText(tabId, selector, timeoutMs = SELECTOR_WAIT_TIMEOUT_MS) {
    if (!selector) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await selectorHasText(tabId, selector)) return true;
        await sleep(SELECTOR_POLL_MS);
    }
    return false;
}

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'add_product') {
        const { data, url, domain, title } = request;
        (async () => {
            try {
                if (await isDeviceBlocked()) {
                    sendResponse({ success: false, blocked: true, error: 'DEVICE_BLOCKED' });
                    return;
                }
                const res = await apiFetch('/products', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url, domain,
                        title: data.title_value || title,
                        selectors: data.selectors || [data.selector_price, data.selector_secondary].filter(Boolean),
                        selector_price: data.selector_price || null,
                        selector_secondary: data.selector_secondary || null,
                        selector_title: data.selector_title,
                        selector_image: data.selector_image,
                        last_image_url: data.image_url || null,
                        is_active: 1,
                        value_type: data.value_type || 'string'
                    })
                });
                const result = await res.json();
                if (result.id) {
                    if (sender.tab?.id) {
                        chrome.tabs.sendMessage(sender.tab.id, {
                            action: 'show_toast', message: '✅ Alan takibe alındı!'
                        });
                    }
                    chrome.storage.local.set({ lastAdded: result.id });
                    await notifyProductsChanged('created', result.id);

                    // Run first scrape immediately after add so card data is available right away.
                    const task = await fetchTaskById(result.id) || {
                        id: result.id,
                        url,
                        selector_price: data.selector_price || null,
                        selector_secondary: data.selector_secondary || null,
                        selector_title: data.selector_title || null,
                        selector_image: data.selector_image || null,
                        wait_on_page: 2,
                        value_type: data.value_type || 'string'
                    };
                    enqueueTasks([task]);

                    sendResponse({ success: true, id: result.id });
                } else {
                    sendResponse({ success: false, error: result.error });
                }
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'get_status') {
        chrome.storage.local.get(['status', 'lastSync', 'lastPoll'], sendResponse);
        return true;
    }

    if (request.action === 'get_access_status') {
        (async () => {
            try {
                const state = await getAccessState();
                sendResponse({
                    ...state,
                    device_id: await ensureDeviceId()
                });
            } catch (e) {
                const state = await setAccessState({
                    status: 'local_app_required',
                    blocked: true,
                    reason: String(e.message || 'Trackify masaüstü uygulaması açık değil.'),
                    blocked_until: null
                });
                sendResponse({
                    ...state,
                    device_id: null
                });
            }
        })();
        return true;
    }

    // Popup manually triggered a product run
    if (request.action === 'run_now') {
        (async () => {
            try {
                if (await isDeviceBlocked()) {
                    sendResponse({ success: false, blocked: true, error: 'DEVICE_BLOCKED' });
                    return;
                }
                const task = await fetchTaskById(request.productId);
                if (task) enqueueTasks([task]);
                sendResponse({ success: true });
            } catch (e) { sendResponse({ success: false, error: e.message }); }
        })();
        return true;
    }
    if (request.action === 'update_product_image') {
        const { productId, imageUrl } = request;
        (async () => {
            try {
                if (await isDeviceBlocked()) {
                    sendResponse({ success: false, blocked: true, error: 'DEVICE_BLOCKED' });
                    return;
                }
                await apiFetch(`/products/${productId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ last_image_url: imageUrl })
                });
                sendResponse({ success: true });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }
});

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(ACCESS_REFRESH_ALARM, { periodInMinutes: ACCESS_REFRESH_MINUTES });
    refreshAccessAndPropagate('register').catch(() => { });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(ACCESS_REFRESH_ALARM, { periodInMinutes: ACCESS_REFRESH_MINUTES });
    refreshAccessAndPropagate('heartbeat').catch(() => { });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== ACCESS_REFRESH_ALARM) return;
    refreshAccessAndPropagate('heartbeat').catch(() => { });
});

chrome.tabs.onActivated.addListener(() => {
    refreshAccessAndPropagate('heartbeat').catch(() => { });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    refreshAccessAndPropagate('heartbeat').catch(() => { });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refresh_access_status') {
        (async () => {
            try {
                const state = await refreshAccessAndPropagate('heartbeat');
                sendResponse({
                    ...state,
                    device_id: await ensureDeviceId()
                });
            } catch (e) {
                const state = await setAccessState({
                    status: 'local_app_required',
                    blocked: true,
                    reason: String(e.message || 'Trackify masaüstü uygulaması açık değil.'),
                    blocked_until: null
                });
                sendResponse({
                    ...state,
                    device_id: null
                });
            }
        })();
        return true;
    }
});

chrome.alarms.create(ACCESS_REFRESH_ALARM, { periodInMinutes: ACCESS_REFRESH_MINUTES });
refreshAccessAndPropagate('register').catch(() => { });
setInterval(pollTasks, POLL_INTERVAL_MS);
pollTasks();

chrome.storage.local.set({ status: 'connected' });
