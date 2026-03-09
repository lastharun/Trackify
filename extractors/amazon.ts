import { Page } from 'playwright';
import { ExtractedData, ExtractionStatus } from './index';

export async function extractAmazon(page: Page): Promise<ExtractedData> {
    return await page.evaluate(() => {
        const titleEl = document.querySelector('#productTitle');
        const title = titleEl ? titleEl.textContent?.trim() : undefined;

        let price: number | undefined = undefined;
        let currency = 'TRY'; // Or parse from symbol

        const whole = document.querySelector('.a-price-whole')?.textContent?.replace(/[,.]/g, '');
        const fraction = document.querySelector('.a-price-fraction')?.textContent || '00';

        if (whole) {
            price = parseFloat(`${whole}.${fraction}`);
        } else {
            // Fallback for simple price span
            const priceSpan = document.querySelector('.a-price .a-offscreen');
            if (priceSpan && priceSpan.textContent) {
                const numericStr = priceSpan.textContent.replace(/[^0-9,.]/g, '').replace(',', '.');
                price = parseFloat(numericStr);
            }
        }

        const outOfStockEl = document.querySelector('#availability span');
        const outOfStockText = outOfStockEl?.textContent?.toLowerCase() || '';
        const inStock = !outOfStockText.includes('currently unavailable') && !outOfStockText.includes('stokta yok');

        // Seller
        const sellerEl = document.querySelector('#merchant-info a') || document.querySelector('#merchant-info span.a-size-small');
        const seller = sellerEl ? sellerEl.textContent?.trim() : 'Amazon';

        return {
            title,
            price,
            currency,
            stock_status: inStock,
            seller
        };
    }).then(async (data: any) => {

        // Basic Captcha Block detection evaluated outside the first block
        const isRobotCheck = await page.evaluate(() => {
            return document.title.includes('Bot Check') || document.body.innerText.includes('Enter the characters you see below');
        });

        if (isRobotCheck) {
            return {
                status: ExtractionStatus.WAF_BLOCKED,
                failureReason: 'Amazon Captcha wall triggered'
            }
        }

        return {
            status: ExtractionStatus.SUCCESS,
            ...data
        };
    }).catch((err: any) => {
        console.error("Amazon extraction error", err);
        return { status: ExtractionStatus.SELECTOR_BROKEN, failureReason: err.message };
    });
}
