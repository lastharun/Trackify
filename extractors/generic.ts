import { Page } from 'playwright';
import { ExtractedData, ExtractionStatus } from './index';

export async function extractGeneric(page: Page): Promise<ExtractedData> {
    const title = await page.title();

    // Attempt to guess price from common ld+json or meta tags
    const priceMeta = await page.evaluate(() => {
        const meta = document.querySelector('meta[property="product:price:amount"]');
        return meta ? meta.getAttribute('content') : null;
    });

    return {
        status: ExtractionStatus.SUCCESS,
        title,
        price: priceMeta ? parseFloat(priceMeta) : undefined,
        currency: 'TRY', // Assume TRY for generic mostly
        stock_status: true,
    };
}
