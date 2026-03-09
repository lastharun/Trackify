import { Page } from 'playwright';
import { ExtractedData, ExtractionStatus } from './index';
import * as cheerio from 'cheerio';

/**
 * Hepsiburada Extractor
 * Pipeline: 
 * 1. JSON-LD (Structured Data)
 * 2. Meta Tags (OpenGraph/Schema)
 * 3. DOM Selectors (Fallback)
 */
export async function extractHepsiburada(page: Page, url?: string): Promise<ExtractedData> {
    const targetUrl = url || page.url();

    // --- Phase 11: Enhanced Human Simulation ---
    try {
        // Move mouse to some random elements to look organic
        await page.mouse.move(100 + Math.random() * 200, 100 + Math.random() * 200, { steps: 5 });
        await page.waitForTimeout(1000 + Math.random() * 1000);

        // Scroll down slowly like reading
        for (let i = 0; i < 3; i++) {
            await page.mouse.wheel(0, 200 + Math.random() * 300);
            await page.waitForTimeout(800 + Math.random() * 1200);
        }

        // Final mouse shimmy
        await page.mouse.move(500, 500, { steps: 10 });

    } catch (e) {
        console.log("Human simulation skipped or failed");
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const pageTitle = await page.title().catch(() => '');

    // --- Block Detection ---
    const isBlocked =
        html.includes('HBBlockandCaptcha') ||
        html.includes('Güvenlik') ||
        html.includes('robot.txt') ||
        pageTitle.includes('Güvenlik') ||
        pageTitle.includes('Access Denied');

    if (isBlocked) {
        return {
            status: ExtractionStatus.WAF_BLOCKED,
            failureReason: 'Akamai WAF or Captcha Detected',
            currency: 'TRY'
        };
    }

    // --- Data Extraction ---
    let title: string | undefined;
    let price: number | undefined;
    let currency = 'TRY';
    let inStock = true;
    let seller: string | undefined;
    const images: string[] = [];
    let description: string | undefined;

    // 1. JSON-LD (Structured Data)
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const content = $(el).html() || '';
            const jsonObj = JSON.parse(content);
            const productData = Array.isArray(jsonObj)
                ? jsonObj.find((item: any) => item['@type'] === 'Product')
                : (jsonObj['@type'] === 'Product' ? jsonObj : null);

            if (productData && !title) {
                title = productData.name;
                description = productData.description;
                if (productData.image) {
                    const imgs = Array.isArray(productData.image) ? productData.image : [productData.image];
                    images.push(...imgs);
                }
                if (productData.offers) {
                    const offer = Array.isArray(productData.offers) ? productData.offers[0] : productData.offers;
                    if (offer.price) price = parseFloat(offer.price.toString().replace(',', '.'));
                    currency = offer.priceCurrency || 'TRY';
                    const avail = offer.availability || '';
                    inStock = !avail.includes('OutOfStock');
                    if (offer.seller?.name) seller = offer.seller.name;
                }
            }
        } catch { }
    });

    // 2. Meta Tags (OpenGraph / Product Meta)
    if (!title) title = $('meta[property="og:title"]').attr('content');
    if (price === undefined) {
        const metaPrice = $('meta[property="product:price:amount"]').attr('content');
        if (metaPrice) price = parseFloat(metaPrice.replace(',', '.'));
        currency = $('meta[property="product:price:currency"]').attr('content') || currency;
    }
    if (!description) description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content');

    // 3. DOM Selectors (Fallback)
    if (!title) {
        title = $('h1#product-name').text().trim() ||
            $('[data-test-id="product-title"]').text().trim() ||
            undefined;
    }
    if (price === undefined) {
        const priceText = $('[data-test-id="price"]').first().text().trim() ||
            $('[data-test-id="default-price"]').first().text().trim() ||
            $('[data-test-id="checkout-price"]').first().text().trim() ||
            $('#offering-price').attr('content') ||
            '';

        if (priceText) {
            // Surgical parse: split by space and find first valid number
            const parts = priceText.split(/\s+/);
            for (const part of parts) {
                const cleaned = part.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
                const parsed = parseFloat(cleaned);
                if (!isNaN(parsed) && parsed > 0) {
                    price = parsed;
                    break;
                }
            }
        }
    }
    if ($('.out-of-stock-icon, [data-test-id="out-of-stock"]').length > 0) inStock = false;
    if (!seller) {
        seller = $('.merchantName, [data-test-id="merchant-name"]').text().trim() || undefined;
    }

    // --- Validation ---
    if (!title && !price) {
        return {
            status: ExtractionStatus.PARTIAL_DATA,
            failureReason: 'Page loaded but essential elements (title/price) missing in DOM/Meta/JSON-LD',
            currency: 'TRY'
        };
    }

    return {
        status: ExtractionStatus.SUCCESS,
        title,
        price,
        currency,
        stock_status: inStock,
        seller,
        images,
        description
    };
}
