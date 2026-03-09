import axios from 'axios';
function cleanText(value: string) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string) {
    return cleanText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function truncate(value: string, max = 240) {
    const text = cleanText(value);
    if (!text) return '(bos)';
    return text.length > max ? text.substring(0, max) + '...' : text;
}

function formatPrice(value: string) {
    const n = Number.parseFloat(String(value).replace(',', '.'));
    if (Number.isFinite(n)) {
        return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} TL`;
    }
    return truncate(value, 60);
}

export async function sendTelegramMessage(token: string, chatId: string, message: string) {
    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: false
        });
        return true;
    } catch (error: any) {
        console.error('Telegram notification error:', error.response?.data || error.message);
        return false;
    }
}

export function formatTemplate(product: any, changeType: string, field: string, oldVal: string, newVal: string, extraData?: any) {
    const title = escapeHtml(product.title || product.url);

    if (changeType === 'PRICE') {
        const nowPrice = escapeHtml(formatPrice(newVal));
        const prevPrice = escapeHtml(formatPrice(oldVal));
        let body = `💸 <b>Fiyat Guncellendi</b>\n\n` +
            `📦 <b>Urun:</b> ${title}\n` +
            `⚡ <b>Simdiki:</b> ${nowPrice}\n` +
            `🕘 <b>Onceki:</b> ${prevPrice}\n`;

        if (extraData?.discountedPrice !== undefined || extraData?.oldDiscountedPrice !== undefined) {
            const nowDiscount = escapeHtml(formatPrice(String(extraData?.discountedPrice ?? '')));
            const prevDiscount = escapeHtml(formatPrice(String(extraData?.oldDiscountedPrice ?? '')));
            body += `\n🏷️ <b>Sepette Simdiki:</b> ${nowDiscount}\n` +
                `🏷️ <b>Sepette Onceki:</b> ${prevDiscount}\n`;
        }

        return `${body}\n🔗 <a href="${product.url}">Urune Git</a>\n\n_Ticaret Takip Premium_`;
    }

    if (changeType === 'STOCK') {
        const nowStatus = newVal === '1' ? 'Stokta Var' : 'Stokta Yok';
        const prevStatus = oldVal === '1' ? 'Stokta Var' : 'Stokta Yok';
        return `📦 <b>Stok Guncellendi</b>\n\n` +
            `📦 <b>Urun:</b> ${title}\n` +
            `⚡ <b>Simdiki:</b> ${escapeHtml(nowStatus)}\n` +
            `🕘 <b>Onceki:</b> ${escapeHtml(prevStatus)}\n\n` +
            `🔗 <a href="${product.url}">Urune Git</a>\n\n` +
            `_Ticaret Takip Premium_`;
    }

    if (changeType === 'VALUE' || changeType === 'CONTENT' || changeType === 'SECONDARY') {
        const header = changeType === 'SECONDARY'
            ? '📌 <b>Yan Alan Degisti</b>'
            : '🔔 <b>Takip Edilen Alan Degisti</b>';
        const selectorLine = changeType === 'SECONDARY' && extraData?.selector
            ? `🎯 <b>CSS:</b> <code>${escapeHtml(String(extraData.selector))}</code>\n`
            : '';

        const nowText = escapeHtml(truncate(newVal, 260));
        const prevText = escapeHtml(truncate(oldVal, 260));

        return `${header}\n\n` +
            `📦 <b>Urun:</b> ${title}\n` +
            selectorLine +
            `⚡ <b>Simdiki:</b> ${nowText}\n` +
            `🕘 <b>Onceki:</b> ${prevText}\n\n` +
            `🔗 <a href="${product.url}">Urune Git</a>\n\n` +
            `_Ticaret Takip Premium_`;
    }

    if (changeType === 'PRICE_ERROR') {
        return `⚠️ <b>Uyari: Fiyat Alani Bulunamadi</b>\n\n` +
            `📦 <b>Urun:</b> ${title}\n` +
            `❌ Fiyat CSS secicisi sayfada eslesmedi. Seciciyi guncellemeniz gerekebilir.\n\n` +
            `🔗 <a href="${product.url}">Urune Git</a>\n\n` +
            `_Ticaret Takip Premium_`;
    }

    return `🔔 <b>Bildirim</b>\n\n` +
        `📦 <b>Urun:</b> ${title}\n` +
        `⚡ <b>Simdiki:</b> ${escapeHtml(truncate(newVal, 180))}\n` +
        `🕘 <b>Onceki:</b> ${escapeHtml(truncate(oldVal, 180))}\n\n` +
        `🔗 <a href="${product.url}">Urune Git</a>\n\n` +
        `_Ticaret Takip Premium_`;
}
