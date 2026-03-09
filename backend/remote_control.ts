import axios from 'axios';
import { db } from '../database/index';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DEV_ID = process.env.TELEGRAM_DEV_ID || CHAT_ID;

let lastUpdateId = 0;
let notificationsEnabled = true;

async function getUpdates() {
    if (!BOT_TOKEN) return [];
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`;
        const response = await axios.get(url);
        return response.data.result || [];
    } catch (error: any) {
        console.error('Telegram polling error:', error.message);
        return [];
    }
}

async function sendMessage(toId: string, text: string) {
    if (!BOT_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: toId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (error: any) {
        console.error('Telegram send error:', error.message);
    }
}

function getDomainFromUrl(url: string): string {
    try {
        const domain = new URL(url).hostname.replace('www.', '').split('.')[0];
        return domain;
    } catch {
        return 'unknown';
    }
}

function parseDuration(input: string): string | null {
    const value = String(input || '').trim().toLowerCase();
    const match = value.match(/^(\d+)(m|h|d)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2];
    const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 60 * 24;
    return `datetime('now', '+${minutes} minutes')`;
}

async function handleCommand(text: string, fromId: string) {
    const isDev = String(fromId) === String(DEV_ID);
    const isAdmin = String(fromId) === String(CHAT_ID) || isDev;

    if (!isAdmin) {
        console.warn(`Unauthorized attempt from ${fromId}`);
        return;
    }

    const args = text.split(' ');
    const command = args[0].toLowerCase();

    switch (command) {
        case '/start':
        case '/help':
            let helpMsg = '🤖 <b>TicaretTakip Yönetim Paneli</b>\n\n' +
                '<b>Temel Komutlar:</b>\n' +
                '/list - Ürünleri listeler\n' +
                '/status - Sistem durumunu gösterir\n' +
                '/add [URL] - Yeni ürün ekler\n' +
                '/delete [ID] - Ürün siler\n' +
                '/toggle - Bildirimleri Aç/Kapat\n' +
                '/ping - Bağlantı kontrolü';

            if (isDev) {
                helpMsg += '\n\n<b>Geliştirici Komutları:</b>\n' +
                    '/stop - Uygulamayı DURDURUR\n' +
                    '/restart - Sistemi YENİDEN BAŞLATIR\n' +
                    '/devices - Son cihazlari listeler\n' +
                    '/block [device_id] [sebep] - Cihazi kalici engeller\n' +
                    '/block_temp [device_id] [1h/1d] [sebep] - Cihazi gecici engeller\n' +
                    '/unblock [device_id] - Cihaz engelini kaldirir';
            }
            await sendMessage(fromId, helpMsg);
            break;

        case '/ping':
            await sendMessage(fromId, '🏓 Pong! Sistem aktif.');
            break;

        case '/status':
            try {
                const total = db.prepare('SELECT COUNT(*) as count FROM products').get() as { count: number };
                const lastCheck = db.prepare('SELECT MAX(last_checked_at) as last FROM products').get() as { last: string };
                await sendMessage(fromId,
                    '📊 <b>Sistem Durumu</b>\n\n' +
                    `📦 Takipteki Ürün: ${total.count}\n` +
                    `🕒 Son Kontrol: ${lastCheck.last || 'Hiç yok'}\n` +
                    `🔔 Bildirimler: ${notificationsEnabled ? 'AÇIK ✅' : 'KAPALI 🛑'}\n` +
                    '🟢 Backend: Çalışıyor'
                );
            } catch (err: any) {
                await sendMessage(fromId, `❌ Hata: ${err.message}`);
            }
            break;

        case '/list':
            try {
                const products = db.prepare('SELECT id, title, domain, url FROM products LIMIT 20').all() as any[];
                if (products.length === 0) {
                    await sendMessage(fromId, '📭 Takip edilen ürün bulunamadı.');
                } else {
                    let list = '📜 <b>Takip Edilen Ürünler (Son 20):</b>\n\n';
                    products.forEach(p => {
                        list += `ID: <code>${p.id}</code> | ${p.domain}\n${p.title?.substring(0, 30) || 'İsimsiz'}\n\n`;
                    });
                    await sendMessage(fromId, list);
                }
            } catch (err: any) {
                await sendMessage(fromId, `❌ Hata: ${err.message}`);
            }
            break;

        case '/add':
            if (args.length < 2) {
                await sendMessage(fromId, '⚠️ Lütfen bir URL belirtin: <code>/add https://...</code>');
                break;
            }
            const url = args[1];
            const domain = getDomainFromUrl(url);
            try {
                const stmt = db.prepare(
                    'INSERT INTO products (url, domain, tracking_interval, created_at, updated_at, last_viewed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
                );
                const info = stmt.run(url, domain, 10);
                await sendMessage(fromId, `✅ Ürün eklendi! ID: <code>${info.lastInsertRowid}</code>\nDomain: ${domain}`);
            } catch (err: any) {
                await sendMessage(fromId, `❌ Ekleme hatası: ${err.message}`);
            }
            break;

        case '/delete':
            if (args.length < 2) {
                await sendMessage(fromId, '⚠️ Lütfen ID belirtin: <code>/delete 123</code>');
                break;
            }
            const id = args[1];
            try {
                // Delete related records first (cascade manual)
                db.prepare('DELETE FROM price_history WHERE product_id = ?').run(id);
                db.prepare('DELETE FROM stock_history WHERE product_id = ?').run(id);
                db.prepare('DELETE FROM change_logs WHERE product_id = ?').run(id);
                const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);

                if (result.changes > 0) {
                    await sendMessage(fromId, `✅ ID: ${id} başarıyla silindi.`);
                } else {
                    await sendMessage(fromId, `❌ ID: ${id} bulunamadı.`);
                }
            } catch (err: any) {
                await sendMessage(fromId, `❌ Silme hatası: ${err.message}`);
            }
            break;

        case '/toggle':
            notificationsEnabled = !notificationsEnabled;
            // Note: This only affects this instance's local variable. 
            // In a real app, you might want to save this to DB/config.
            await sendMessage(fromId, `🔔 Bildirimler artık <b>${notificationsEnabled ? 'AÇIK' : 'KAPALI'}</b>.`);
            break;

        case '/stop':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            await sendMessage(fromId, '🛑 Uygulama durduruluyor...');
            setTimeout(() => process.exit(0), 1000);
            break;

        case '/restart':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            await sendMessage(fromId, '🔄 Sistem yeniden başlatılıyor (LaunchAgent varsa otomatik açılacaktır)...');
            setTimeout(() => process.exit(0), 1000);
            break;

        case '/devices':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            try {
                const devices = db.prepare(`
                    SELECT device_id, device_name, platform, status, blocked_until, last_seen_at
                    FROM devices
                    ORDER BY last_seen_at DESC
                    LIMIT 20
                `).all() as any[];
                if (!devices.length) {
                    await sendMessage(fromId, '📭 Kayitli cihaz yok.');
                    break;
                }
                const lines = devices.map((device, index) =>
                    `${index + 1}. <code>${device.device_id}</code>\n` +
                    `   ${device.device_name || device.platform || 'Bilinmeyen cihaz'}\n` +
                    `   Durum: <b>${device.status}</b>${device.blocked_until ? ` (${device.blocked_until})` : ''}\n` +
                    `   Son gorulme: ${device.last_seen_at || 'yok'}`
                );
                await sendMessage(fromId, `🖥️ <b>Son Cihazlar</b>\n\n${lines.join('\n\n')}`);
            } catch (err: any) {
                await sendMessage(fromId, `❌ Cihaz listeleme hatasi: ${err.message}`);
            }
            break;

        case '/block':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            if (args.length < 2) {
                await sendMessage(fromId, '⚠️ Kullanim: <code>/block device_id sebep</code>');
                break;
            }
            try {
                const deviceId = args[1];
                const reason = args.slice(2).join(' ').trim() || 'Developer tarafindan kalici olarak engellendi.';
                db.prepare(`
                    INSERT INTO devices (device_id, status, blocked_until, reason, created_at, updated_at, last_seen_at)
                    VALUES (?, 'perm_block', NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(device_id) DO UPDATE SET
                        status = 'perm_block',
                        blocked_until = NULL,
                        reason = excluded.reason,
                        updated_at = CURRENT_TIMESTAMP
                `).run(deviceId, reason);
                await sendMessage(fromId, `⛔ Cihaz engellendi:\n<code>${deviceId}</code>\nSebep: ${reason}`);
            } catch (err: any) {
                await sendMessage(fromId, `❌ Engelleme hatasi: ${err.message}`);
            }
            break;

        case '/block_temp':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            if (args.length < 3) {
                await sendMessage(fromId, '⚠️ Kullanim: <code>/block_temp device_id 1h sebep</code>');
                break;
            }
            try {
                const deviceId = args[1];
                const durationSql = parseDuration(args[2]);
                if (!durationSql) {
                    await sendMessage(fromId, '⚠️ Sure formati gecersiz. Ornek: <code>30m</code>, <code>12h</code>, <code>7d</code>');
                    break;
                }
                const reason = args.slice(3).join(' ').trim() || 'Developer tarafindan gecici olarak engellendi.';
                db.prepare(`
                    INSERT INTO devices (device_id, status, blocked_until, reason, created_at, updated_at, last_seen_at)
                    VALUES (?, 'temp_block', ${durationSql}, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT(device_id) DO UPDATE SET
                        status = 'temp_block',
                        blocked_until = ${durationSql},
                        reason = excluded.reason,
                        updated_at = CURRENT_TIMESTAMP
                `).run(deviceId, reason);
                await sendMessage(fromId, `⏳ Cihaz gecici engellendi:\n<code>${deviceId}</code>\nSure: ${args[2]}\nSebep: ${reason}`);
            } catch (err: any) {
                await sendMessage(fromId, `❌ Gecici engelleme hatasi: ${err.message}`);
            }
            break;

        case '/unblock':
            if (!isDev) {
                await sendMessage(fromId, '🚫 Bu komut sadece geliştiriciye özeldir.');
                break;
            }
            if (args.length < 2) {
                await sendMessage(fromId, '⚠️ Kullanim: <code>/unblock device_id</code>');
                break;
            }
            try {
                const deviceId = args[1];
                const result = db.prepare(`
                    UPDATE devices
                    SET status = 'active',
                        blocked_until = NULL,
                        reason = NULL,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE device_id = ?
                `).run(deviceId);
                await sendMessage(fromId, result.changes
                    ? `✅ Cihaz engeli kaldirildi:\n<code>${deviceId}</code>`
                    : `❌ Cihaz bulunamadi: <code>${deviceId}</code>`);
            } catch (err: any) {
                await sendMessage(fromId, `❌ Engel kaldirma hatasi: ${err.message}`);
            }
            break;
    }
}

export async function startRemoteControl() {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.error('Telegram bot credentials missing.');
        return;
    }

    console.log('Advanced Telegram Remote Control Active.');

    (async () => {
        while (true) {
            const updates = await getUpdates();
            for (const update of updates) {
                lastUpdateId = update.update_id;
                if (update.message?.text) {
                    await handleCommand(update.message.text, String(update.message.chat.id));
                }
            }
            if (updates.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    })();
}

export function isNotificationsEnabled() {
    return notificationsEnabled;
}
