import * as cheerio from 'cheerio';
import { ExtractedData, ExtractionStatus } from './index';

export async function extractTrendyol(url: string, pageDataFromPlaywright?: string): Promise<ExtractedData> {
    try {
        let htmlContext = pageDataFromPlaywright;

        // If Playwright failed or was blocked (Page Not Found), fetch with basic HTTP
        if (!htmlContext || htmlContext.includes('Aradığınız Sayfa Bulunamadı')) {
            console.log("Playwright/Fetch Blocked on Trendyol. Falling back to cURL...");
            try {
                // If url is passed as a Playwright Page object, handle it
                const targetUrl = typeof url === 'string' ? url : (url as any).url();
                const curlCmd = `curl -s -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' '${targetUrl}'`;
                htmlContext = require('child_process').execSync(curlCmd, { maxBuffer: 1024 * 1024 * 10 }).toString();
            } catch (curlErr) {
                console.error("cURL Fallback failed", curlErr);
            }
        }

        const $ = cheerio.load(htmlContext || '');

        let title, price, currency = 'TRY', inStock = true, seller;
        let images: string[] = [];
        let description = '';

        // Try extracting JSON-LD first
        const ldJsonScripts = $('script[type="application/ld+json"]');
        for (let i = 0; i < ldJsonScripts.length; i++) {
            try {
                const jsonObj = JSON.parse($(ldJsonScripts[i]).html() || '{}');
                if (jsonObj['@type'] === 'Product') {
                    title = jsonObj.name;
                    description = jsonObj.description;
                    if (jsonObj.image) {
                        images = Array.isArray(jsonObj.image) ? jsonObj.image : [jsonObj.image];
                    }
                    if (jsonObj.offers) {
                        price = jsonObj.offers.price ? parseFloat(jsonObj.offers.price) : undefined;
                        currency = jsonObj.offers.priceCurrency || 'TRY';
                        inStock = jsonObj.offers.availability === "http://schema.org/InStock" || jsonObj.offers.availability === "https://schema.org/InStock";
                        if (jsonObj.offers.seller && jsonObj.offers.seller.name) {
                            seller = jsonObj.offers.seller.name;
                        }
                    }
                    break;
                }
            } catch (e) {
                // Ignore parse errors on individual scripts
            }
        }

        // DOM Fallbacks if JSON-LD is missing
        if (!title) {
            title = $('.pr-new-br span').text().trim() || $('h1').first().text().trim();
        }

        if (price === undefined) {
            let priceStr = $('.prc-dsc').first().text().trim() || $('.prc-slg').first().text().trim();
            if (priceStr) {
                const cleanStr = priceStr.replace('TL', '').trim().replace(/\./g, '').replace(',', '.');
                price = parseFloat(cleanStr);
            }
        }

        // --- Phase 12: Dual Price Extraction (Basket & Original) ---
        let originalPrice: number | undefined;
        let discountedPrice: number | undefined;

        const basketPriceStr = $('.ty-plus-price-discounted-price').first().text().trim();
        if (basketPriceStr) {
            const cleanBasket = basketPriceStr.replace('TL', '').trim().replace(/\./g, '').replace(',', '.');
            discountedPrice = parseFloat(cleanBasket);
        }

        const originalPriceStr = $('.ty-plus-price-original-price').first().text().trim();
        if (originalPriceStr) {
            const cleanOriginal = originalPriceStr.replace('TL', '').trim().replace(/\./g, '').replace(',', '.');
            originalPrice = parseFloat(cleanOriginal);
        }

        // If we found a discounted price, it might be the "real" price to track as primary
        if (discountedPrice !== undefined && price === undefined) {
            price = discountedPrice;
        }

        if (seller === undefined) {
            seller = $('.merchant-box-wrapper a').first().text().trim() || $('.merchant-text').first().text().trim();
        }

        const btnEl = $('.add-to-basket');
        if (btnEl.length > 0) {
            inStock = !btnEl.attr('disabled');
        }

        // Block Detection Validation
        if (!title && !price) {
            return {
                status: ExtractionStatus.WAF_BLOCKED,
                failureReason: 'Failed to extract Title and Price - likely a block page.'
            }
        }

        return {
            status: ExtractionStatus.SUCCESS,
            title,
            price,
            currency,
            stock_status: inStock,
            seller,
            images,
            description,
            originalPrice,
            discountedPrice,
            rawHtml: htmlContext // Return raw HTML to save
        };
    } catch (err: any) {
        console.error("Trendyol fetch error:", err);
        return { status: ExtractionStatus.SELECTOR_BROKEN, failureReason: err.message, currency: 'TRY' };
    }
}
