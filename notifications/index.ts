import { sendTelegramMessage, formatTemplate } from './telegram';
import { db } from '../database/index';

export function getUserTelegramConfig() {
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = String(
        settings.telegram_user_id
        || settings.telegram_chat_id
        || settings['telegram-id']
        || process.env.TELEGRAM_CHAT_ID
        || ''
    ).trim();
    const enabled = String(settings.telegram_notifications ?? settings.telegram_enabled ?? '1') !== '0';

    return { token, chatId, enabled, settings };
}

export async function notifyChange(product: any, changeType: string, field: string, oldVal: string, newVal: string, extraData?: any) {
    const message = formatTemplate(product, changeType, field, oldVal, newVal, extraData);

    console.log(`\n================= NOTIFICATION =================`);
    console.log(`[${changeType}] ${product.title || product.url}`);

    const { token, chatId, enabled } = getUserTelegramConfig();

    if (enabled && token && chatId) {
        console.log(`--> Sending Telegram message to ${chatId}...`);
        await sendTelegramMessage(token, chatId, message);
    } else {
        console.log(`--> Skip Telegram: Bot credentials missing or Chat ID not set`);
        console.log(`   Message would be: ${message.replace(/<[^>]*>/g, '')}`);
    }

    // Email mock
    if (process.env.SMTP_HOST) {
        console.log(`--> Sending Email to user...`);
    }

    console.log(`================================================\n`);
}
