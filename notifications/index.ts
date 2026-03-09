import { sendTelegramMessage, formatTemplate } from './telegram';
import { db } from '../database/index';

export async function notifyChange(product: any, changeType: string, field: string, oldVal: string, newVal: string, extraData?: any) {
    const message = formatTemplate(product, changeType, field, oldVal, newVal, extraData);

    console.log(`\n================= NOTIFICATION =================`);
    console.log(`[${changeType}] ${product.title || product.url}`);

    // Telegram Notification
    const token = process.env.TELEGRAM_BOT_TOKEN;

    // 1. Try to get chat ID from settings DB (user configured)
    let chatId: string | undefined;
    try {
        const settingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('telegram-id') as { value: string };
        if (settingRow && settingRow.value) {
            chatId = settingRow.value;
        }
    } catch (e) {
        // Table might not exist or other DB err
    }

    // 2. Fallback to ENV DEVELOPER chat ID
    if (!chatId) {
        chatId = process.env.TELEGRAM_CHAT_ID;
    }

    if (token && chatId) {
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

