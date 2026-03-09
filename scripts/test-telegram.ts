import dotenv from 'dotenv';
import path from 'path';
import { notifyChange } from '../notifications/index';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const testProduct = {
    id: 999,
    title: 'Test Ürünü (iPhone 15 Pro)',
    url: 'https://www.apple.com/tr/iphone-15-pro/',
    domain: 'apple.com'
};

async function runTest() {
    console.log('🚀 Telegram testi başlatılıyor...');
    console.log(`Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? '✅ Tanımlı' : '❌ EKSİK'}`);
    console.log(`Chat ID: ${process.env.TELEGRAM_CHAT_ID ? '✅ Tanımlı' : '❌ EKSİK'}`);

    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
        console.error('\n❌ HATA: .env dosyasında bilgiler eksik! Lütfen dosyayı kontrol edip bilgileri yapıştırın.');
        process.exit(1);
    }

    try {
        await notifyChange(testProduct, 'PRICE', 'price', '85.000', '79.999');
        console.log('\n✅ Test mesajı komutu gönderildi! Lütfen Telegram botunuzu kontrol edin.');
    } catch (error) {
        console.error('\n❌ Beklenmedik bir hata oluştu:', error);
    }
}

runTest();
