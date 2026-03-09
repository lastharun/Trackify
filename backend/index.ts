import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db, initDb } from '../database/index';
import { formatTemplate, sendTelegramMessage } from '../notifications/telegram';
import { isNotificationsEnabled, startRemoteControl } from './remote_control';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize database
initDb();

startRemoteControl();

function splitSelectorList(...values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    const selectors: string[] = [];

    for (const value of values) {
        if (!value) continue;
        for (const part of String(value).split(',')) {
            const selector = part.trim();
            if (!selector || seen.has(selector)) continue;
            seen.add(selector);
            selectors.push(selector);
        }
    }

    return selectors;
}

function normalizeSelectorFields(data: Record<string, any>) {
    if (!data) return { selector_price: null, selector_secondary: null };

    const selectorList = splitSelectorList(
        data.selectors,
        data.selector_price,
        data.selector_secondary
    );

    return {
        selector_price: selectorList[0] || null,
        selector_secondary: selectorList.slice(1).join(', ') || null
    };
}

function getDeviceIdFromRequest(req: any) {
    return String(req.headers['x-trackify-device-id'] || req.headers['x-device-id'] || '').trim();
}

function getEffectiveDeviceAccess(device: any) {
    if (!device) {
        return { status: 'active', isBlocked: false, blocked_until: null, reason: null };
    }

    const status = String(device.status || 'active');
    if (status === 'perm_block') {
        return { status, isBlocked: true, blocked_until: null, reason: device.reason || null };
    }

    if (status === 'temp_block') {
        const blockedUntil = device.blocked_until ? new Date(String(device.blocked_until).replace(' ', 'T') + 'Z') : null;
        if (blockedUntil && blockedUntil.getTime() > Date.now()) {
            return { status, isBlocked: true, blocked_until: device.blocked_until || null, reason: device.reason || null };
        }

        db.prepare(`
            UPDATE devices
            SET status = 'active', blocked_until = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(device.id);
    }

    return { status: 'active', isBlocked: false, blocked_until: null, reason: null };
}

function upsertDevice(payload: Record<string, any>) {
    const deviceId = String(payload.device_id || '').trim();
    if (!deviceId) throw new Error('device_id is required');

    db.prepare(`
        INSERT INTO devices (device_id, device_name, platform, user_agent, extension_version, status, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(device_id) DO UPDATE SET
            device_name = excluded.device_name,
            platform = excluded.platform,
            user_agent = excluded.user_agent,
            extension_version = excluded.extension_version,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        deviceId,
        payload.device_name || null,
        payload.platform || null,
        payload.user_agent || null,
        payload.extension_version || null
    );

    const device = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as any;
    return {
        device,
        access: getEffectiveDeviceAccess(device)
    };
}

app.use('/api', (req, res, next) => {
    if (req.path === '/device/bootstrap' || req.path === '/device/status') {
        return next();
    }

    const deviceId = getDeviceIdFromRequest(req);
    if (!deviceId) return next();

    try {
        const device = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as any;
        const access = getEffectiveDeviceAccess(device);
        if (!access.isBlocked) return next();

        return res.status(403).json({
            error: 'DEVICE_BLOCKED',
            blocked: true,
            status: access.status,
            blocked_until: access.blocked_until,
            reason: access.reason || 'Bu cihaz devre disi birakildi.'
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

function parseSecondaryMap(value: any) {
    if (!value) return {};
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function getSelectorDetails(product: any, selector: string | null, role: 'primary' | 'secondary') {
    const primary = String(product.selector_price || '').trim();
    const secondarySelectors = String(product.selector_secondary || '')
        .split(',')
        .map((part: string) => part.trim())
        .filter(Boolean);
    const allSelectors = [primary, ...secondarySelectors].filter(Boolean);
    const resolvedSelector = String(selector || '').trim() || (role === 'primary' ? primary : '');
    const overallIndex = resolvedSelector ? allSelectors.indexOf(resolvedSelector) + 1 : 0;
    const secondaryIndex = resolvedSelector ? secondarySelectors.indexOf(resolvedSelector) + 1 : 0;

    return JSON.stringify({
        role,
        selector: resolvedSelector || null,
        css_index: overallIndex > 0 ? overallIndex : null,
        secondary_index: role === 'secondary' && secondaryIndex > 0 ? secondaryIndex : null
    });
}

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        service: 'trackify-backend',
        notifications_enabled: isNotificationsEnabled(),
        time: new Date().toISOString()
    });
});

// Routes
app.get('/api/products', (req, res) => {
    try {
        const { search, domain, sort = 'unread_changes', order = 'DESC', limit = 10, offset = 0 } = req.query;

        let whereClause = 'WHERE 1=1';
        const params: any[] = [];

        if (search) {
            whereClause += ` AND (p.title LIKE ? OR p.url LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (domain && domain !== 'all') {
            whereClause += ` AND p.domain = ?`;
            params.push(domain);
        }

        // Validate sort field to prevent SQL injection
        const allowedSort = ['title', 'domain', 'tracking_interval', 'last_checked_at', 'updated_at', 'unread_changes'];
        const sortField = allowedSort.includes(String(sort)) ? String(sort) : 'unread_changes';
        const sortOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const query = `
            SELECT p.*, 
            (SELECT COUNT(*) FROM change_logs c WHERE c.product_id = p.id AND c.timestamp > p.last_viewed_at) as unread_changes
            FROM products p 
            ${whereClause}
            ORDER BY unread_changes DESC, p.updated_at DESC
            LIMIT ? OFFSET ?
        `;

        const countQuery = `SELECT COUNT(*) as count FROM products p ${whereClause}`;

        const products = db.prepare(query).all(...params, limit, offset);
        const total = db.prepare(countQuery).get(...params) as { count: number };

        res.json({ products, total: total.count });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', (req, res) => {
    let { url, domain, title, trackingInterval, selector_price, selector_secondary, selector_title, selector_image, last_image_url, value_type, wait_on_page, never_stop } = req.body;
    if (!url || !domain) {
        return res.status(400).json({ error: 'URL and domain are required' });
    }

    ({ selector_price, selector_secondary } = normalizeSelectorFields(req.body));

    try {
        // Fetch defaults from settings if not provided
        const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[];
        const s = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

        console.log(`[POST /api/products] Original body:`, JSON.stringify(req.body));
        console.log(`[POST /api/products] Current settings:`, JSON.stringify(s));

        if (!trackingInterval) trackingInterval = parseInt(s.default_interval || '30');
        if (wait_on_page === undefined) wait_on_page = parseInt(s.wait_on_page || '4');
        if (never_stop === undefined) never_stop = s.never_stop_on_errors === '1' ? 1 : 0;

        console.log(`[POST /api/products] Final values: iv=${trackingInterval}, wait=${wait_on_page}, never_stop=${never_stop}`);

        const stmt = db.prepare(
            'INSERT INTO products (url, domain, title, tracking_interval, selector_price, selector_secondary, selector_title, selector_image, last_image_url, value_type, wait_on_page, never_stop, last_value, last_secondary_value, created_at, updated_at, last_viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
        );
        const info = stmt.run(url, domain, title || null, trackingInterval, selector_price || null, selector_secondary || null, selector_title || null, selector_image || null, last_image_url || null, value_type || 'string', wait_on_page, never_stop, '', '');
        res.status(201).json({ id: info.lastInsertRowid });
    } catch (err: any) {
        if (err.message.includes('UNIQUE constraint failed')) {
            // Product URL already exists. Update selectors.
            const existing = db.prepare('SELECT id, selector_price, selector_secondary FROM products WHERE url = ?').get(url) as any;

            let appended = false;
            let updateQueries = [];
            let updateParams = [];

            if (existing) {
                const existingSelectors = splitSelectorList(existing.selector_price, existing.selector_secondary);
                const mergedSelectors = splitSelectorList(existing.selector_price, existing.selector_secondary, selector_price, selector_secondary);
                appended = mergedSelectors.length > existingSelectors.length;

                const normalizedExisting = {
                    selector_price: existingSelectors[0] || null,
                    selector_secondary: existingSelectors.slice(1).join(', ') || null
                };
                const normalizedMerged = {
                    selector_price: mergedSelectors[0] || null,
                    selector_secondary: mergedSelectors.slice(1).join(', ') || null
                };

                if (normalizedMerged.selector_price !== normalizedExisting.selector_price) {
                    updateQueries.push('selector_price = ?');
                    updateParams.push(normalizedMerged.selector_price);
                }
                if (normalizedMerged.selector_secondary !== normalizedExisting.selector_secondary) {
                    updateQueries.push('selector_secondary = ?');
                    updateParams.push(normalizedMerged.selector_secondary);
                }
            }

            // Always apply latest default settings when re-adding/updating
            const settingsRows = db.prepare('SELECT key, value FROM settings').all() as any[];
            const s = Object.fromEntries(settingsRows.map(r => [r.key, r.value]));

            updateQueries.push('tracking_interval = ?');
            updateParams.push(parseInt(s.default_interval || '30'));

            updateQueries.push('wait_on_page = ?');
            updateParams.push(parseInt(s.wait_on_page || '4'));

            updateQueries.push('never_stop = ?');
            updateParams.push(s.never_stop_on_errors === '1' ? 1 : 0);

            if (value_type) {
                updateQueries.push('value_type = ?');
                updateParams.push(value_type);
            }

            if (selector_title !== undefined) {
                updateQueries.push('selector_title = ?');
                updateParams.push(selector_title || null);
            }

            if (selector_image !== undefined) {
                updateQueries.push('selector_image = ?');
                updateParams.push(selector_image || null);
            }

            if (last_image_url !== undefined) {
                updateQueries.push('last_image_url = ?');
                updateParams.push(last_image_url || null);
            }

            if (updateQueries.length > 0) {
                // Also ensure existing ones are normalized if they were NULL
                const query = `UPDATE products SET ${updateQueries.join(', ')}, last_value = COALESCE(last_value, ''), last_secondary_value = COALESCE(last_secondary_value, ''), updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
                db.prepare(query).run(...updateParams, existing.id);
                return res.status(200).json({ id: existing.id, appended });
            }

            return res.status(200).json({ id: existing?.id, appended: false, message: 'Selectors already tracked' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id', (req, res) => {
    try {
        // Update last_viewed_at when product is accessed
        db.prepare('UPDATE products SET last_viewed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
        if (!product) return res.status(404).json({ error: 'Not found' });
        res.json(product);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/products/:id', (req, res) => {
    try {
        const id = req.params.id;
        const updates = { ...req.body };

        if ('selectors' in updates || 'selector_price' in updates || 'selector_secondary' in updates) {
            const normalized = normalizeSelectorFields(updates);
            updates.selector_price = normalized.selector_price;
            updates.selector_secondary = normalized.selector_secondary;
            delete updates.selectors;
        }

        const fields = Object.keys(updates);

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        const setClause = fields.map(f => `${f} = ?`).join(', ');
        const params = fields.map(f => updates[f]);

        const query = `UPDATE products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        const result = db.prepare(query).run(...params, id);

        if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', (req, res) => {
    try {
        const id = req.params.id;
        db.prepare('DELETE FROM price_history WHERE product_id = ?').run(id);
        db.prepare('DELETE FROM seller_history WHERE product_id = ?').run(id);
        db.prepare('DELETE FROM stock_history WHERE product_id = ?').run(id);
        db.prepare('DELETE FROM change_logs WHERE product_id = ?').run(id);
        db.prepare('DELETE FROM snapshots WHERE product_id = ?').run(id);
        const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
        if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id/history', (req, res) => {
    try {
        const priceHistory = db.prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY timestamp DESC').all(req.params.id);
        const sellerHistory = db.prepare('SELECT * FROM seller_history WHERE product_id = ? ORDER BY timestamp DESC').all(req.params.id);
        const stockHistory = db.prepare('SELECT * FROM stock_history WHERE product_id = ? ORDER BY timestamp DESC').all(req.params.id);
        res.json({ priceHistory, sellerHistory, stockHistory });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id/history', (req, res) => {
    try {
        db.prepare('DELETE FROM price_history WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM seller_history WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM stock_history WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM change_logs WHERE product_id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id/changes', (req, res) => {
    try {
        const changes = db.prepare('SELECT * FROM change_logs WHERE product_id = ? ORDER BY timestamp DESC').all(req.params.id);
        res.json(changes);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id/logs', (req, res) => {
    try {
        const logs = db.prepare('SELECT * FROM scrape_logs WHERE product_id = ? ORDER BY timestamp DESC LIMIT 20').all(req.params.id);
        res.json(logs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
        const priceChanges = db.prepare(`SELECT COUNT(*) as count FROM change_logs WHERE change_type = 'PRICE'`).get() as { count: number };
        const recentChanges = db.prepare('SELECT * FROM change_logs ORDER BY timestamp DESC LIMIT 5').all();

        res.json({
            totalProducts: totalProducts.count,
            priceChanges: priceChanges.count,
            recentChanges
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// --- Extension Bridge API ---
app.get('/api/extension/tasks', (req, res) => {
    try {
        console.log(`[EXTENSION_POLL] Extension is asking for tasks...`);
        const query = `
            SELECT id, url, selector_price, selector_secondary, selector_title, selector_image, tracking_interval, wait_on_page, never_stop, domain, value_type
            FROM products 
            WHERE is_active = 1
            AND (
                (selector_price IS NOT NULL AND selector_price != '') 
                OR domain = 'hepsiburada'
            )
            AND (
                (next_check_at IS NULL AND (last_checked_at IS NULL OR (julianday('now') - julianday(last_checked_at)) * 24 * 60 >= tracking_interval))
                OR (next_check_at IS NOT NULL AND next_check_at <= CURRENT_TIMESTAMP)
            )
            LIMIT 10
        `;
        const tasks = db.prepare(query).all();
        console.log(`[EXTENSION_POLL] Found ${tasks.length} extension-tracked tasks. Sending to extension.`);
        res.json(tasks);
    } catch (err: any) {
        console.error("Extension tasks error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/extension/tasks/:id', (req, res) => {
    try {
        const task = db.prepare(`
            SELECT id, url, selector_price, selector_secondary, selector_title, selector_image, tracking_interval, wait_on_page, never_stop, domain, value_type
            FROM products
            WHERE id = ?
            AND is_active = 1
            AND (
                (selector_price IS NOT NULL AND selector_price != '')
                OR domain = 'hepsiburada'
            )
        `).get(req.params.id);

        if (!task) return res.status(404).json({ error: 'Task not found' });
        res.json(task);
    } catch (err: any) {
        console.error('Extension task lookup error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/extension/sync', async (req, res) => {
    try {
        const data = req.body;
        const productId = data.productId;

        if (!productId) return res.status(400).json({ error: 'productId is required' });

        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as any;
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const notifications: string[] = [];
        let changed = false;

        // ── 1. PRICE TRACKING ─────────────────────────────────────────────────────
        if (product.selector_price) {
            const shouldTrackAsPrice = product.value_type === 'price';

            if (shouldTrackAsPrice && data.price_not_found) {
                // Selector exists but returned nothing → PRICE_ERROR
                db.prepare(`INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value, timestamp)
                    VALUES (?, 'PRICE_ERROR', 'selector_price', ?, 'NOT_FOUND', CURRENT_TIMESTAMP)`)
                    .run(productId, product.selector_price);
                changed = true;
                const msg = `⚠️ <b>${product.title || product.url}</b>\n\nFiyat selektörü artık eşleşmiyor!\n<code>${product.selector_price}</code>`;
                notifications.push(msg);

                // Send Telegram if enabled
                if (product.notification_telegram) {
                    const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
                    const s = Object.fromEntries(settings.map((r: any) => [r.key, r.value]));
                    if (s.telegram_enabled === '1' && s.telegram_bot_token && s.telegram_chat_id) {
                        const { sendTelegramMessage } = await import('../notifications/telegram');
                        await sendTelegramMessage(s.telegram_bot_token, s.telegram_chat_id, msg).catch(() => { });
                    }
                }
            } else if (data.value !== undefined) {
                // Unified primary selector tracking — price extraction is optional.
                const incomingValue = data.value ?? '';
                db.prepare(`
                    UPDATE products
                    SET last_value = ?,
                        last_checked_at = CURRENT_TIMESTAMP,
                        next_check_at = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(String(incomingValue), productId);

                const { handleExtractionResult } = await import('../workers/processor');
                const enrichedData = {
                    ...data,
                    status: 'SUCCESS',
                    statusCode: 200,
                    finalUrl: data.url,
                    pageTitle: data.title,
                    value: data.value ?? '',
                    price: shouldTrackAsPrice ? data.price ?? null : null,
                };
                await handleExtractionResult(product, enrichedData);
                changed = (enrichedData as any).__valueChanged || changed;
                const notifMsg = (enrichedData as any).__notificationMsg;
                if (notifMsg) notifications.push(notifMsg);
            }
        } else if (!product.selector_price && data.price !== undefined) {
            // No dedicated price selector but we got a price anyway (old behavior)
            const { handleExtractionResult } = await import('../workers/processor');
            const enrichedData = {
                ...data,
                status: data.status === 'CONTENT_SCRIPT_ERROR' ? 'CONTENT_SCRIPT_ERROR' : 'SUCCESS',
                statusCode: 200, finalUrl: data.url, pageTitle: data.title,
                value: data.value ?? '',
            };
            await handleExtractionResult(product, enrichedData);
            changed = (enrichedData as any).__valueChanged || changed;
            const notifMsg = (enrichedData as any).__notificationMsg;
            if (notifMsg) notifications.push(notifMsg);
        }

        // ── 2. SECONDARY CSS TRACKING ──────────────────────────────────────────────
        if (data.secondary_value !== undefined && data.secondary_value !== null) {
            const newSecVal = String(data.secondary_value).trim();
            const previousSecondaryMap = parseSecondaryMap(product.last_secondary_map);
            const secondaryItems = Array.isArray(data.secondary_items) ? data.secondary_items : [];
            const currentSecondaryMap = secondaryItems.reduce((acc: Record<string, string>, item: any) => {
                const selector = String(item?.selector || '').trim();
                if (!selector) return acc;
                acc[selector] = String(item?.value || '').trim();
                return acc;
            }, {});
            const selectorChanges = Object.keys(currentSecondaryMap).map((selector) => {
                const previousValue = String(previousSecondaryMap[selector] || '').trim();
                const currentValue = String(currentSecondaryMap[selector] || '').trim();
                const isFirstSeen = !(selector in previousSecondaryMap);
                const hasChanged = previousValue !== currentValue;
                return { selector, previousValue, currentValue, isFirstSeen, hasChanged };
            }).filter((entry) => entry.hasChanged);

            for (const entry of selectorChanges) {
                const shouldPersistHistory = entry.currentValue !== '' || entry.previousValue !== '';
                if (!shouldPersistHistory) continue;

                db.prepare(`INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value, details_json, timestamp)
                    VALUES (?, 'SECONDARY', ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
                    .run(
                        productId,
                        entry.selector,
                        entry.previousValue,
                        entry.currentValue,
                        getSelectorDetails(product, entry.selector, 'secondary')
                    );

                // First capture of a newly-added secondary selector should appear in history,
                // but should not generate user-facing notifications.
                if (entry.isFirstSeen) continue;

                changed = true;

                const msg = formatTemplate(
                    product,
                    'SECONDARY',
                    entry.selector,
                    entry.previousValue,
                    entry.currentValue,
                    { selector: entry.selector }
                );
                notifications.push(msg);

                if (product.notification_telegram) {
                    const settings = db.prepare('SELECT key, value FROM settings').all() as any[];
                    const s = Object.fromEntries(settings.map((r: any) => [r.key, r.value]));
                    if (s.telegram_enabled === '1' && s.telegram_bot_token && s.telegram_chat_id) {
                        await sendTelegramMessage(s.telegram_bot_token, s.telegram_chat_id, msg).catch(() => { });
                    }
                }
            }

            // Update stored secondary value
            db.prepare('UPDATE products SET last_secondary_value = ?, last_secondary_map = ?, last_checked_at = CURRENT_TIMESTAMP, next_check_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(newSecVal, JSON.stringify(currentSecondaryMap), productId);
        } else {
            // Update last_checked_at even if no secondary
            db.prepare('UPDATE products SET last_checked_at = CURRENT_TIMESTAMP, next_check_at = NULL WHERE id = ?').run(productId);
        }

        console.log(`[SYNC] Product ${productId}: changed=${changed}, price=${data.price}, secondary="${data.secondary_value}"`);
        res.json({ success: true, changed, notifications });
    } catch (err: any) {
        console.error('Extension sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── Settings API ────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
    try {
        // Ensure table exists
        db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();
        const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
        const settings: Record<string, string> = {};
        rows.forEach(r => settings[r.key] = r.value);
        res.json(settings);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/settings', (req, res) => {
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`).run();
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key is required' });
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
        res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.post('/api/device/bootstrap', (req, res) => {
    try {
        const { device, access } = upsertDevice(req.body || {});
        res.json({
            success: true,
            device_id: device.device_id,
            status: access.status,
            blocked: access.isBlocked,
            blocked_until: access.blocked_until,
            reason: access.reason
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/device/status', (req, res) => {
    try {
        const deviceId = getDeviceIdFromRequest(req) || String(req.query.device_id || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_id is required' });

        const device: any = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId);
        if (!device) return res.json({ success: true, status: 'active', blocked: false });

        const access = getEffectiveDeviceAccess(device);
        db.prepare('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(device.id);
        res.json({
            success: true,
            device_id: device.device_id,
            status: access.status,
            blocked: access.isBlocked,
            blocked_until: access.blocked_until,
            reason: access.reason
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/test-telegram', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not configured in .env' });
        const { sendTelegramMessage } = await import('../notifications/telegram');
        await sendTelegramMessage(token, userId, '🧪 <b>Price Tracker Test</b>\n\nTelegram bildirimleri aktif! Fiyat değişimlerini buradan takip edeceksiniz.');
        res.json({ success: true });
    } catch (err: any) {
        console.error('Test telegram error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
});

// Manual worker trigger endpoint for debugging (Generic - picks oldest overdue)
app.post('/api/run-worker', async (req, res) => {
    try {
        const { processProduct } = await import('../workers/processor');
        const query = `
            SELECT * FROM products 
            WHERE (selector_price IS NULL OR selector_price = '')
            AND (
                (next_check_at IS NULL AND (last_checked_at IS NULL OR (julianday('now') - julianday(last_checked_at)) * 24 * 60 >= tracking_interval))
                OR (next_check_at IS NOT NULL AND next_check_at <= CURRENT_TIMESTAMP)
            )
            ORDER BY last_checked_at ASC LIMIT 1
        `;
        const product = db.prepare(query).get() as any;

        if (!product) {
            return res.json({ message: 'Kontrol edilecek backend-izlemeli ürün yok.' });
        }

        if (product.domain === 'hepsiburada') {
            // "Prime" it for the extension instead of running here
            db.prepare("UPDATE products SET last_checked_at = datetime('now', '-1 day'), next_check_at = CURRENT_TIMESTAMP WHERE id = ?").run(product.id);
            return res.json({ message: 'Hepsiburada ürünü tespit edildi. Uzantı için sıraya alındı (30sn içinde kontrol edilecek).', product: product.id });
        }

        console.log(`Manual trigger for: ${product.url}`);
        await processProduct(product);
        const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(product.id);
        res.json({ message: 'Ürün işlendi', product: updated });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Specific product refresh endpoint
app.post('/api/products/:id/run', async (req, res) => {
    try {
        const id = req.params.id;
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;

        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

        // Any selector-tracked product is extension-managed and must not run backend extractor.
        if (product.selector_price && String(product.selector_price).trim() !== '') {
            db.prepare("UPDATE products SET last_checked_at = datetime('now', '-1 day'), next_check_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
            return res.json({ success: true, message: 'Ürün uzantı tarama kuyruğuna alındı. Birkaç saniye içinde güncellenecek.' });
        }

        if (product.domain === 'hepsiburada') {
            // Reset timers so extension picks it up immediately
            db.prepare("UPDATE products SET last_checked_at = datetime('now', '-1 day'), next_check_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
            return res.json({ success: true, message: 'Hepsiburada ürünü tarayıcı eklentisi için kuyruğa alındı. Lütfen uzantının açık olduğunu kontrol edin.' });
        } else {
            const { processProduct } = await import('../workers/processor');
            await processProduct(product);
            const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
            return res.json({ success: true, message: 'Ürün backend üzerinden güncellendi.', product: updated });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
