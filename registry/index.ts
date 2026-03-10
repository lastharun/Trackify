import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import crypto from 'crypto';
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
type LicenseStatus = 'active' | 'disabled';

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
        license_key: normalizeLicenseKey(input?.license_key),
        owner_label: String(input?.owner_label || '').trim() || null,
        device_name: String(input?.device_name || '').trim() || null,
        platform: String(input?.platform || '').trim() || null,
        user_agent: String(input?.user_agent || '').trim() || null,
        app_version: String(input?.app_version || '').trim() || null,
        meta_json: input?.meta ? JSON.stringify(input.meta) : null
    };
}

function normalizeLicenseKey(input: any) {
    return String(input || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
}

function generateLicenseKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(12);
    const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    return raw.match(/.{1,4}/g)?.join('-') || raw;
}

function getLicense(licenseKey: string) {
    return registryDb.prepare(`SELECT * FROM licenses WHERE license_key = ?`).get(normalizeLicenseKey(licenseKey)) as any;
}

function getDevice(deviceId: string) {
    return registryDb.prepare(`SELECT * FROM devices WHERE device_id = ?`).get(deviceId) as any;
}

function getEffectiveLicenseStatus(license: any) {
    if (!license) {
        return { status: 'missing', active: false, reason: 'Lisans anahtarı bulunamadı.' };
    }

    if (String(license.status || 'active') !== 'active') {
        return { status: 'disabled', active: false, reason: 'Bu lisans devre dışı bırakıldı.' };
    }

    const expiresAt = parseDbDate(license.expires_at);
    if (expiresAt && expiresAt.getTime() < Date.now()) {
        return { status: 'expired', active: false, reason: 'Bu lisansın süresi dolmuş.' };
    }

    return { status: 'active', active: true, reason: null };
}

function ensureLicenseBinding(deviceId: string, providedLicenseKey: string | null, existingDevice?: any) {
    const normalizedKey = normalizeLicenseKey(providedLicenseKey || existingDevice?.license_key || '');
    if (!normalizedKey) {
        return {
            ok: false,
            error: 'LICENSE_REQUIRED',
            reason: 'Lisans anahtarı girilmedi.'
        };
    }

    const license = getLicense(normalizedKey);
    const effective = getEffectiveLicenseStatus(license);
    if (!effective.active) {
        return {
            ok: false,
            error: effective.status === 'expired' ? 'LICENSE_EXPIRED' : 'LICENSE_INVALID',
            reason: effective.reason,
            license
        };
    }

    if (license.bound_device_id && license.bound_device_id !== deviceId) {
        return {
            ok: false,
            error: 'LICENSE_IN_USE',
            reason: `Bu lisans başka bir cihazda aktif: ${license.bound_device_id}`,
            license
        };
    }

    if (!license.bound_device_id) {
        registryDb.prepare(`
            UPDATE licenses
            SET bound_device_id = ?,
                last_activated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE license_key = ?
        `).run(deviceId, normalizedKey);
    } else {
        registryDb.prepare(`
            UPDATE licenses
            SET last_activated_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE license_key = ?
        `).run(normalizedKey);
    }

    return {
        ok: true,
        license: getLicense(normalizedKey)
    };
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
    const licenseBinding = ensureLicenseBinding(device.device_id, device.license_key, existing);
    if (!licenseBinding.ok) {
        return {
            device: existing || null,
            isNew: false,
            access: {
                status: licenseBinding.error === 'LICENSE_EXPIRED' ? 'license_expired' : 'license_required',
                blocked: true,
                reason: licenseBinding.reason,
                blocked_until: licenseBinding.license?.expires_at || null
            }
        };
    }

    const license = licenseBinding.license;
    const isNew = !existing;
    const clientIp = getClientIp(req || ({} as express.Request));

    registryDb.prepare(`
        INSERT INTO devices (
            device_id, license_key, owner_label, device_name, platform, user_agent, app_version, last_ip, meta_json, license_expires_at,
            status, last_seen_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(device_id) DO UPDATE SET
            license_key = COALESCE(excluded.license_key, devices.license_key),
            owner_label = COALESCE(excluded.owner_label, devices.owner_label),
            device_name = COALESCE(excluded.device_name, devices.device_name),
            platform = COALESCE(excluded.platform, devices.platform),
            user_agent = COALESCE(excluded.user_agent, devices.user_agent),
            app_version = COALESCE(excluded.app_version, devices.app_version),
            last_ip = COALESCE(excluded.last_ip, devices.last_ip),
            meta_json = COALESCE(excluded.meta_json, devices.meta_json),
            license_expires_at = COALESCE(excluded.license_expires_at, devices.license_expires_at),
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
    `).run(
        device.device_id,
        license.license_key,
        device.owner_label || license.owner_label || null,
        device.device_name,
        device.platform,
        device.user_agent,
        device.app_version,
        clientIp,
        device.meta_json,
        license.expires_at || null
    );

    logDeviceEvent(device.device_id, isNew ? 'register' : 'heartbeat', {
        license_key: license.license_key,
        owner_label: device.owner_label,
        device_name: device.device_name,
        platform: device.platform,
        app_version: device.app_version,
        last_ip: clientIp,
        at: nowIso()
    });

    return {
        device: getDevice(device.device_id),
        isNew,
        access: getEffectiveStatus(getDevice(device.device_id))
    };
}

function listDevices(filters: { limit?: number; search?: string; status?: string; online_hours?: number }) {
    const where: string[] = [];
    const params: any[] = [];

    if (filters.search) {
        where.push(`(
            device_id LIKE ?
            OR COALESCE(license_key, '') LIKE ?
            OR COALESCE(owner_label, '') LIKE ?
            OR COALESCE(device_name, '') LIKE ?
            OR COALESCE(platform, '') LIKE ?
        )`);
        const like = `%${filters.search}%`;
        params.push(like, like, like, like, like);
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
        SELECT device_id, license_key, owner_label, device_name, platform, user_agent, app_version, last_ip,
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

function listLicenses(filters: { limit?: number; search?: string; status?: string }) {
    const where: string[] = [];
    const params: any[] = [];

    if (filters.search) {
        const like = `%${filters.search}%`;
        where.push(`(
            license_key LIKE ?
            OR COALESCE(owner_label, '') LIKE ?
            OR COALESCE(bound_device_id, '') LIKE ?
            OR COALESCE(notes, '') LIKE ?
        )`);
        params.push(like, like, like, like);
    }

    if (filters.status === 'bound') {
        where.push(`bound_device_id IS NOT NULL AND TRIM(bound_device_id) <> ''`);
    } else if (filters.status === 'unbound') {
        where.push(`bound_device_id IS NULL OR TRIM(bound_device_id) = ''`);
    } else if (filters.status) {
        where.push(`status = ?`);
        params.push(filters.status);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return registryDb.prepare(`
        SELECT *
        FROM licenses
        ${clause}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ?
    `).all(...params, Number(filters.limit || 200)) as any[];
}

function createLicense(payload: any) {
    const licenseKey = normalizeLicenseKey(payload?.license_key) || generateLicenseKey();
    const ownerLabel = String(payload?.owner_label || '').trim() || null;
    const expiresAt = String(payload?.expires_at || '').trim() || null;
    const notes = String(payload?.notes || '').trim() || null;
    const status = String(payload?.status || 'active').trim() === 'disabled' ? 'disabled' : 'active';
    const maxDevices = Math.max(1, Number(payload?.max_devices || 1) || 1);

    registryDb.prepare(`
        INSERT INTO licenses (license_key, owner_label, status, expires_at, notes, max_devices, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(licenseKey, ownerLabel, status, expiresAt, notes, maxDevices);

    return getLicense(licenseKey);
}

function updateLicense(licenseKey: string, payload: any) {
    const normalizedKey = normalizeLicenseKey(licenseKey);
    const updates: string[] = [];
    const params: any[] = [];

    if ('owner_label' in payload) {
        updates.push('owner_label = ?');
        params.push(String(payload.owner_label || '').trim() || null);
    }
    if ('expires_at' in payload) {
        updates.push('expires_at = ?');
        params.push(String(payload.expires_at || '').trim() || null);
    }
    if ('notes' in payload) {
        updates.push('notes = ?');
        params.push(String(payload.notes || '').trim() || null);
    }
    if ('status' in payload) {
        updates.push('status = ?');
        params.push(String(payload.status || 'active').trim() === 'disabled' ? 'disabled' : 'active');
    }
    if ('max_devices' in payload) {
        updates.push('max_devices = ?');
        params.push(Math.max(1, Number(payload.max_devices || 1) || 1));
    }
    if (!updates.length) return getLicense(normalizedKey);

    registryDb.prepare(`
        UPDATE licenses
        SET ${updates.join(', ')},
            updated_at = CURRENT_TIMESTAMP
        WHERE license_key = ?
    `).run(...params, normalizedKey);

    const license = getLicense(normalizedKey);
    if (license) {
        registryDb.prepare(`
            UPDATE devices
            SET owner_label = COALESCE(?, owner_label),
                license_expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE license_key = ?
        `).run(license.owner_label || null, license.expires_at || null, normalizedKey);
    }

    return license;
}

function resetLicenseBinding(licenseKey: string) {
    const normalizedKey = normalizeLicenseKey(licenseKey);
    registryDb.prepare(`
        UPDATE licenses
        SET bound_device_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE license_key = ?
    `).run(normalizedKey);
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
        const { device, isNew, access } = upsertDevice(req.body || {}, req);

        if (isNew && device) {
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
            device_id: device?.device_id || String(req.body?.device_id || '').trim() || null,
            status: access.status,
            blocked: access.blocked,
            blocked_until: access.blocked_until,
            reason: access.reason,
            owner_label: device?.owner_label || null,
            license_expires_at: device?.license_expires_at || access.blocked_until || null,
            license_key: device?.license_key || normalizeLicenseKey(req.body?.license_key)
        });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post('/api/devices/heartbeat', (req, res) => {
    try {
        const { device, access } = upsertDevice(req.body || {}, req);
        res.json({
            success: true,
            device_id: device?.device_id || String(req.body?.device_id || '').trim() || null,
            status: access.status,
            blocked: access.blocked,
            blocked_until: access.blocked_until,
            reason: access.reason,
            owner_label: device?.owner_label || null,
            license_expires_at: device?.license_expires_at || access.blocked_until || null,
            license_key: device?.license_key || normalizeLicenseKey(req.body?.license_key)
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

app.get('/api/admin/session', requireAdmin, (_req, res) => {
    res.json({ ok: true });
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

app.delete('/api/admin/devices/:deviceId', requireAdmin, (req, res) => {
    try {
        const deviceId = String(req.params.deviceId || '').trim();
        if (!deviceId) return res.status(400).json({ error: 'device_id is required' });

        const existing = getDevice(deviceId);
        if (!existing) return res.status(404).json({ error: 'not found' });

        registryDb.prepare(`UPDATE licenses SET bound_device_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE bound_device_id = ?`).run(deviceId);
        registryDb.prepare(`DELETE FROM devices WHERE device_id = ?`).run(deviceId);
        res.json({ success: true, device_id: deviceId });
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

app.get('/api/admin/licenses', requireAdmin, (req, res) => {
    try {
        const licenses = listLicenses({
            limit: Number(req.query.limit || 200),
            search: String(req.query.search || '').trim() || undefined,
            status: String(req.query.status || '').trim() || undefined
        });
        res.json({ licenses });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/licenses', requireAdmin, (req, res) => {
    try {
        const license = createLicense(req.body || {});
        res.status(201).json({ success: true, license });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/licenses/:licenseKey', requireAdmin, (req, res) => {
    try {
        const licenseKey = normalizeLicenseKey(req.params.licenseKey);
        const license = getLicense(licenseKey);
        if (!license) return res.status(404).json({ error: 'not found' });
        const device = license.bound_device_id ? getDevice(license.bound_device_id) : null;
        res.json({ license, device });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/admin/licenses/:licenseKey', requireAdmin, (req, res) => {
    try {
        const license = updateLicense(String(req.params.licenseKey || ''), req.body || {});
        if (!license) return res.status(404).json({ error: 'not found' });
        res.json({ success: true, license });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/licenses/:licenseKey/reset-device', requireAdmin, (req, res) => {
    try {
        resetLicenseBinding(String(req.params.licenseKey || ''));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Trackify registry running on http://localhost:${PORT}`);
    startTelegramPolling();
});
