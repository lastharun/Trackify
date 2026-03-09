import { extractProductData } from './extractors/index';

async function runTest() {
    const testUrls = [
        { url: 'https://www.trendyol.com/apple/iphone-13-128-gb-yildiz-isigi-cep-telefonu-apple-turkiye-garantili-p-152202613', domain: 'trendyol' },
        { url: 'https://www.hepsiburada.com/apple-iphone-13-128-gb-p-HBCV00000ODJG1', domain: 'hepsiburada' }
    ];

    for (let i = 0; i < testUrls.length; i++) {
        const item = testUrls[i];
        console.log(`\n\n--- Testing ${item.domain} ---`);
        console.log(`URL: ${item.url}`);

        const data = await extractProductData(item.url, item.domain, { productId: 8000 + i });

        console.log('\nResult:');
        console.log(`Status: ${data.status}`);
        if (data.failureReason) console.log(`Failure Reason: ${data.failureReason}`);
        console.log(`Title: ${data.title}`);
        console.log(`Price: ${data.price} ${data.currency}`);
        if (data.originalPrice) console.log(`Original Price: ${data.originalPrice}`);
        if (data.discountedPrice) console.log(`Discounted (Basket) Price: ${data.discountedPrice}`);
        console.log(`Stock: ${data.stock_status}`);
        console.log(`Seller: ${data.seller}`);
        console.log(`Images Count: ${data.images?.length || 0}`);

        if (data.rawHtml) {
            console.log(`HTML Captured: Yes (${data.rawHtml.length} chars)`);
        } else {
            console.log('HTML Captured: No');
        }
    }
}

runTest().catch(console.error);
