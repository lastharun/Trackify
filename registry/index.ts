import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initRegistryDb, registryDb } from './db';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

initRegistryDb();

const PORT = Number(process.env.REGISTRY_PORT || 3010);
const ADMIN_TOKEN = String(process.env.REGISTRY_ADMIN_TOKEN || '').trim();
const TELEGRAM_SEND_TOKEN = String(process.env.REGISTRY_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_POLL_TOKEN = String(process.env.REGISTRY_TELEGRAM_BOT_TOKEN || '').trim();
const DEV_CHAT_ID = String(process.env.REGISTRY_TELEGRAM_DEV_ID || process.env.TELEGRAM_DEV_ID || '').trim();
const publicDir = path.resolve(__dirname, 'public');
const downloadsDir = path.join(publicDir, 'downloads');
const updatesDir = path.join(publicDir, 'updates');
const extensionUpdateManifestPath = path.join(updatesDir, 'extension.json');
const desktopUpdateManifestPath = path.join(updatesDir, 'desktop.json');

let lastTelegramUpdateId = 0;

type DeviceStatus = 'active' | 'temp_block' | 'perm_block';

function nowIso() {
    return new Date().toISOString();
}

function parseDbDate(value: string | null | undefined) {
    if (!value) return null;
    return new Date(String(value).replace(' ', 'T') + 'Z');
}

function parseTempDuration(raw: string) {
    const match = String(raw || '').trim().toLowerCase().match(/^(\d+)(m|h|d)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2];
    const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 60 * 24;
    return {
        minutes,
        sql: `datetime('now', '+${minutes} minutes')`
    };
}

function getClientIp(req: express.Request) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const socketIp = req.socket.remoteAddress || '';
    return forwarded || socketIp || null;
}

function sanitizeDevice(input: any) {
    return {
        device_id: String(input?.device_id || '').trim(),
        owner_label: String(input?.owner_label || '').trim() || null,
        device_name: String(input?.device_name || '').trim() || null,
        platform: String(input?.platform || '').trim() || null,
        user_agent: String(input?.user_agent || '').trim() || null,
        app_version: String(input?.app_version || '').trim() || null,
        meta_json: input?.meta ? JSON.stringify(input.meta) : null
    };
}

function getDevice(deviceId: string) {
    return registryDb.prepare(`SELECT * FROM devices WHERE device_id = ?`).get(deviceId) as any;
}

function getEffectiveStatus(device: any) {
    if (!device) {
        return { status: 'active', blocked: false, reason: null, blocked_until: null };
    }

    const licenseExpiresAt = parseDbDate(device.license_expires_at);
    if (licenseExpiresAt && licenseExpiresAt.getTime() < Date.now()) {
        return {
            status: 'license_expired',
            blocked: true,
            reason: device.reason || 'Lisans suresi doldu.',
            blocked_until: device.license_expires_at || null
        };
    }

    const status = String(device.status || 'active');
    if (status === 'perm_block') {
        return {
            status,
            blocked: true,
            reason: device.reason || null,
            blocked_until: null
        };
    }

    if (status === 'temp_block') {
        const blockedUntilDate = parseDbDate(device.blocked_until);
        if (blockedUntilDate && blockedUntilDate.getTime() > Date.now()) {
            return {
                status,
                blocked: true,
                reason: device.reason || null,
                blocked_until: device.blocked_until || null
            };
        }

        registryDb.prepare(`
            UPDATE devices
            SET status = 'active',
                blocked_until = NULL,
                reason = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE device_id = ?
        `).run(device.device_id);
    }

    return { status: 'active', blocked: false, reason: null, blocked_until: null };
}

function logDeviceEvent(deviceId: string, eventType: string, payload: Record<string, any>) {
    registryDb.prepare(`
        INSERT INTO device_events (device_id, event_type, payload_json)
        VALUES (?, ?, ?)
    `).run(deviceId, eventType, JSON.stringify(payload));
}

function upsertDevice(input: any, req?: express.Request) {
    const device = sanitizeDevice(input);
    if (!device.device_id) throw new Error('device_id is required');

    const existing = getDevice(device.device_id);
    const isNew = !existing;
    const clientIp = getClientIp(req || ({} as express.Request));

    registryDb.prepare(`
        INSERT INTO devices (
            device_id, owner_label, device_name, platform, user_agent, app_version, last_ip, meta_json,
            status, last_seen_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(device_id) DO UPDATE SET
            owner_label = COALESCE(excluded.owner_label, devices.owner_label),
            device_name = COALESCE(excluded.device_name, devices.device_name),
            platform = COALESCE(excluded.platform, devices.platform),
            user_agent = COALESCE(excluded.user_agent, devices.user_agent),
            app_version = COALESCE(excluded.app_version, devices.app_version),
            last_ip = COALESCE(excluded.last_ip, devices.last_ip),
            meta_json = COALESCE(excluded.meta_json, devices.meta_json),
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        device.device_id,
        device.owner_label,
        device.device_name,
        device.platform,
        device.user_agent,
        device.app_version,
        clientIp,
        device.meta_json
    );

    logDeviceEvent(device.device_id, isNew ? 'register' : 'heartbeat', {
        owner_label: device.owner_label,
        device_name: device.device_name,
        platform: device.platform,
        app_version: device.app_version,
        last_ip: clientIp,
        at: nowIso()
    });

    return { device: getDevice(device.device_id), isNew };
}

function listDevices(filters: { limit?: number; search?: string; status?: string; online_hours?: number }) {
    const where: string[] = [];
    const params: any[] = [];

    if (filters.search) {
        where.push(`(
            device_id LIKE ?
            OR COALESCE(owner_label, '') LIKE ?
            OR COALESCE(device_name, '') LIKE ?
            OR COALESCE(platform, '') LIKE ?
        )`);
        const like = `%${filters.search}%`;
        params.push(like, like, like, like);
    }

    if (filters.status === 'online') {
        const hours = Number(filters.online_hours || 24);
        where.push(`last_seen_at >= datetime('now', ?)`); 
        params.push(`-${hours} hours`);
    } else if (filters.status) {
        where.push(`status = ?`);
        params.push(filters.status);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return registryDb.prepare(`
        SELECT device_id, owner_label, device_name, platform, user_agent, app_version, last_ip,
               status, license_expires_at, blocked_until, reason, meta_json, last_seen_at, created_at, updated_at
        FROM devices
        ${clause}
        ORDER BY last_seen_at DESC
        LIMIT ?
    `).all(...params, Number(filters.limit || 200)) as any[];
}

function getDeviceEvents(deviceId: string, limit = 30) {
    return registryDb.prepare(`
        SELECT id, event_type, payload_json, created_at
        FROM device_events
        WHERE device_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `).all(deviceId, limit) as any[];
}

function setDeviceBlock(deviceId: string, mode: DeviceStatus, reason: string, duration?: string) {
    if (mode === 'temp_block') {
        const parsed = parseTempDuration(String(duration || '').trim());
        if (!parsed) throw new Error('valid duration is required');
        registryDb.prepare(`
            INSERT INTO devices (device_id, status, blocked_until, reason, created_at, updated_at, last_seen_at)
            VALUES (?, 'temp_block', ${parsed.sql}, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(device_id) DO UPDATE SET
                status = 'temp_block',
                blocked_until = ${parsed.sql},
                reason = excluded.reason,
                updated_at = CURRENT_TIMESTAMP
        `).run(deviceId, reason);
        logDeviceEvent(deviceId, 'temp_block', { duration, reason, at: nowIso() });
        return;
    }

    registryDb.prepare(`
        INSERT INTO devices (device_id, status, blocked_until, reason, created_at, updated_at, last_seen_at)
        VALUES (?, 'perm_block', NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(device_id) DO UPDATE SET
            status = 'perm_block',
            blocked_until = NULL,
            reason = excluded.reason,
            updated_at = CURRENT_TIMESTAMP
    `).run(deviceId, reason);
    logDeviceEvent(deviceId, 'perm_block', { reason, at: nowIso() });
}

function unblockDevice(deviceId: string) {
    registryDb.prepare(`
        UPDATE devices
        SET status = 'active',
            blocked_until = NULL,
            reason = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
    `).run(deviceId);
    logDeviceEvent(deviceId, 'unblock', { at: nowIso() });
}

function updateDeviceMeta(deviceId: string, payload: any) {
    const updates: string[] = [];
    const params: any[] = [];

    if ('owner_label' in payload) {
        updates.push('owner_label = ?');
        params.push(String(payload.owner_label || '').trim() || null);
    }
    if ('reason' in payload) {
        updates.push('reason = ?');
        params.push(String(payload.reason || '').trim() || null);
    }
    if ('license_expires_at' in payload) {
        updates.push('license_expires_at = ?');
        params.push(String(payload.license_expires_at || '').trim() || null);
    }
    if ('status' in payload) {
        updates.push('status = ?');
        params.push(String(payload.status || 'active').trim());
    }

    if (!updates.length) return;

    registryDb.prepare(`
        UPDATE devices
        SET ${updates.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        WHERE device_id = ?
    `).run(...params, deviceId);

    logDeviceEvent(deviceId, 'meta_update', {
        owner_label: payload.owner_label,
        reason: payload.reason,
        license_expires_at: payload.license_expires_at,
        status: payload.status,
        at: nowIso()
    });
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!ADMIN_TOKEN) {
        return res.status(500).json({ error: 'REGISTRY_ADMIN_TOKEN is not configured' });
    }

    const token = String(req.headers['x-registry-admin-token'] || req.query.admin_token || '').trim();
    if (token !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    next();
}

async function sendTelegram(text: string) {
    if (!TELEGRAM_SEND_TOKEN || !DEV_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_SEND_TOKEN}/sendMessage`, {
            chat_id: DEV_CHAT_ID,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (error: any) {
        console.error('Registry telegram send error:', error.response?.data || error.message);
    }
}

async function getTelegramUpdates() {
    if (!TELEGRAM_POLL_TOKEN) return [];
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_POLL_TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=25`;
        const response = await axios.get(url);
        return response.data.result || [];
    } catch (error: any) {
        console.error('Registry telegram polling error:', error.message);
        return [];
    }
}

function formatDeviceLine(row: any, index: number) {
    return `${index + 1}. <code>${row.device_id}</code>\n` +
        `${row.owner_label || row.device_name || row.platform || 'Bilinmeyen cihaz'}\n` +
        `Durum: <b>${row.status}</b>${row.blocked_until ? ` (${row.blocked_until})` : ''}\n` +
        `Son gorulme: ${row.last_seen_at || '-'}\n` +
        `IP: ${row.last_ip || '-'}`;
}

async function handleTelegramCommand(text: string, fromId: string) {
    if (!DEV_CHAT_ID || String(fromId) !== DEV_CHAT_ID) return;

    const args = String(text || '').trim().split(/\s+/);
    const command = (args[0] || '').toLowerCase();

    if (command === '/devices') {
        const rows = listDevices({ limit: 20 });
        if (!rows.length) {
            await sendTelegram('📭 Kayitli cihaz yok.');
            return;
        }
        await sendTelegram(`🖥️ <b>Registry Devices</b>\n\n${rows.map(formatDeviceLine).join('\n\n')}`);
        return;
    }

    if (command === '/block') {
        const deviceId = args[1];
        const reason = args.slice(2).join(' ').trim() || 'Developer tarafindan kalici engellendi.';
        if (!deviceId) {
            await sendTelegram('⚠️ Kullanim: <code>/block device_id sebep</code>');
            return;
        }
        setDeviceBlock(deviceId, 'perm_block', reason);
        await sendTelegram(`⛔ Engellendi\n<code>${deviceId}</code>\nSebep: ${reason}`);
        return;
    }

    if (command === '/block_temp') {
        const deviceId = args[1];
        const duration = args[2];
        const reason = args.slice(3).join(' ').trim() || 'Developer tarafindan gecici engellendi.';
        if (!deviceId || !parseTempDuration(duration)) {
            await sendTelegram('⚠️ Kullanim: <code>/block_temp device_id 12h sebep</code>');
            return;
        }
        setDeviceBlock(deviceId, 'temp_block', reason, duration);
        await sendTelegram(`⏳ Gecici engellendi\n<code>${deviceId}</code>\nSure: ${duration}\nSebep: ${reason}`);
        return;
    }

    if (command === '/unblock') {
        const deviceId = args[1];
        if (!deviceId) {
            await sendTelegram('⚠️ Kullanim: <code>/unblock device_id</code>');
            return;
        }
        unblockDevice(deviceId);
        await sendTelegram(`✅ Engel kaldirildi\n<code>${deviceId}</code>`);
        return;
    }
}

function startTelegramPolling() {
    if (!TELEGRAM_POLL_TOKEN || !DEV_CHAT_ID) {
        if (TELEGRAM_SEND_TOKEN && DEV_CHAT_ID && !TELEGRAM_POLL_TOKEN) {
            console.log('Registry telegram polling disabled: set REGISTRY_TELEGRAM_BOT_TOKEN to enable Telegram commands.');
        }
        return;
    }

    (async () => {
        while (true) {
            const updates = await getTelegramUpdates();
            for (const update of updates) {
                lastTelegramUpdateId = update.update_id;
                if (update.message?.text) {
                    await handleTelegramCommand(String(update.message.text), String(update.message.chat.id));
                }
            }
            if (updates.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    })();
}

app.use('/downloads', express.static(downloadsDir));
app.use('/panel', express.static(publicDir));
app.get('/', (_req, res) => res.redirect('/panel/'));

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'trackify-registry' });
});

app.get('/api/updates/extension', (_req, res) => {
    try {
        const manifest = JSON.parse(fs.readFileSync(extensionUpdateManifestPath, 'utf8'));
        res.json(manifest);
    } catch {
        res.status(404).json({ error: 'extension_update_not_found' });
    }
});

app.get('/api/updates/desktop', (_req, res) => {
    try {
        const manifest = JSON.parse(fs.readFileSync(desktopUpdateManifestPath, 'utf8'));
        res.json(manifest);
    } catch {
        res.status(404).json({ error: 'desktop_update_not_found' });
    }
});

app.post('/api/devices/register', async (req, res) => {
    try {
        const { device, isNew } = upsertDevice(req.body || {}, req);
        const access = getEffectiveStatus(device);

        if (isNew) {
            await sendTelegram(
                `🆕 <b>Yeni cihaz kaydoldu</b>\n\n` +
                `ID: <code>${device.device_id}</code>\n` +
                `Ad: ${device.device_name || '-'}\n` +
                `Platform: ${device.platform || '-'}\n` +
                `Versiyon: ${device.app_version || '-'}\n` +
                `IP: ${device.last_ip || '-'}`
            );
        }

        res.json({
            success: true,
            device_id: device.device_id,
            status: access.status,
            blocked: access.blocked,
            blocked_until: access.blocked_until,
            reason: access.reason,
            owner_label: device.owner_label,
            license_expires_at: device.license_expires_at || null
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/devices/heartbeat', (req, res) => {
    try {
        const { device } = upsertDevice(req.body || {}, req);
        const access = getEffectiveStatus(device);
        res.json({
            success: true,
            device_id: device.device_id,
            status: access.status,
            blocked: access.blocked,
            blocked_until: access.blocked_until,
            reason: access.reason,
            owner_label: device.owner_label,
            license_expires_at: device.license_expires_at || null
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/devices/:deviceId/status', (req, res) => {
    try {
        const device = getDevice(String(req.params.deviceId || '').trim());
        const access = getEffectiveStatus(device);
        res.json({
            success: true,
            device_id: req.params.deviceId,
            status: access.status,
            blocked: access.blocked,
            blocked_until: access.blocked_until,
            reason: access.reason,
            owner_label: device?.owner_label || null,
            license_expires_at: device?.license_expires_at || null
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/devices', requireAdmin, (req, res) => {
    try {
        const devices = listDevices({
            limit: Number(req.query.limit || 200),
            search: String(req.query.search || '').trim() || undefined,
            status: String(req.query.status || '').trim() || undefined,
            online_hours: Number(req.query.online_hours || 24)
        });
        res.json({ devices });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/devices/:deviceId', requireAdmin, (req, res) => {
    try {
        const deviceId = String(req.params.deviceId || '').trim();
        const device = getDevice(deviceId);
        if (!device) return res.status(404).json({ error: 'not found' });
        const access = getEffectiveStatus(device);
        res.json({
            device: {
                ...device,
                effective_status: access.status,
                blocked: access.blocked
            },
            events: getDeviceEvents(deviceId, 50)
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/admin/devices/:deviceId', requireAdmin, (req, res) => {
    try {
        const deviceId = String(req.params.deviceId || '').trim();
        updateDeviceMeta(deviceId, req.body || {});
        res.json({ success: true, device: getDevice(deviceId) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/devices/:deviceId/block', requireAdmin, (req, res) => {
    try {
        const deviceId = String(req.params.deviceId || '').trim();
        const mode = String(req.body?.mode || 'perm').trim();
        const reason = String(req.body?.reason || '').trim() || 'Admin tarafindan engellendi.';
        if (mode === 'temp') {
            setDeviceBlock(deviceId, 'temp_block', reason, String(req.body?.duration || ''));
        } else {
            setDeviceBlock(deviceId, 'perm_block', reason);
        }
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/devices/:deviceId/unblock', requireAdmin, (req, res) => {
    try {
        unblockDevice(String(req.params.deviceId || '').trim());
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Trackify registry running on http://localhost:${PORT}`);
    startTelegramPolling();
});
