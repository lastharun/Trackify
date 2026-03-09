import 'dotenv/config';
import { notifyChange } from './notifications/index';

async function run() {
    const product = {
        title: 'Örnek Takip Edilen Ürün - Test',
        url: 'https://www.hepsiburada.com/ornek-urun',
        domain: 'hepsiburada',
        last_price: 1599.99
    };

    console.log("Yan CSS (SECONDARY) Test Bildirimi Gönderiliyor...");
    await notifyChange(product, 'SECONDARY', 'Yan Alan', 'Stokta Var', 'Stokta Yok');

    console.log("Fiyat Yok (PRICE_ERROR) Test Bildirimi Gönderiliyor...");
    await notifyChange(product, 'PRICE_ERROR', 'Fiyat', '1599.99', 'Bulunamadı');

    console.log("Test Tamamlandı.");
    process.exit(0);
}

run().catch(console.error);
