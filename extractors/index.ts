import { chromium } from 'patchright';
import { extractGeneric } from './generic';
import { extractAmazon } from './amazon';
import { extractTrendyol } from './trendyol';
import { extractHepsiburada } from './hepsiburada';
import os from 'os';
import path from 'path';
import fs from 'fs';

export enum ExtractionStatus {
    SUCCESS = "SUCCESS",
    PARTIAL_DATA = "PARTIAL_DATA",
    PRODUCT_NOT_FOUND = "PRODUCT_NOT_FOUND",
    CONSENT_BLOCKED = "CONSENT_BLOCKED",
    WAF_BLOCKED = "WAF_BLOCKED",
    SELECTOR_BROKEN = "SELECTOR_BROKEN",
    TIMEOUT = "TIMEOUT"
}

export interface ExtractedData {
    status: ExtractionStatus;
    failureReason?: string;

    title?: string;
    price?: number;
    currency?: string;
    seller?: string;
    stock_status?: boolean;
    description?: string;
    rawHtml?: string;
    rawHtmlSnippet?: string;
    images?: string[];
    other_sellers?: { name: string; price: number }[];
    delivery_text?: string;
    originalPrice?: number;
    discountedPrice?: number;

    // Telemetry
    statusCode?: number;
    finalUrl?: string;
    pageTitle?: string;
}

export interface ExtractionRunOptions {
    productId: number;
    botType?: 'standard' | 'search_engine';
    jsEnabled?: boolean;
    proxy?: {
        server: string;
        username?: string;
        password?: string;
    };
    headless?: boolean;
}

export async function extractProductData(url: string, domain: string, options?: ExtractionRunOptions): Promise<ExtractedData> {

    // Explicitly set the temp directory Playwright uses to a safe local folder
    process.env.TMPDIR = path.join(os.tmpdir(), 'pw-artifacts');
    if (!fs.existsSync(process.env.TMPDIR)) {
        fs.mkdirSync(process.env.TMPDIR, { recursive: true });
    }

    const botType = options?.botType || 'standard';

    // Default User Agent
    let userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    let extraHeaders: Record<string, string> = {
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
    };

    if (botType === 'search_engine') {
        // Try YandexBot or BingBot which Akamai might trust more
        const useYandex = Math.random() > 0.5;
        if (useYandex) {
            userAgent = 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)';
            extraHeaders['Referer'] = 'https://yandex.com.tr/';
        } else {
            userAgent = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
            extraHeaders['Referer'] = 'https://www.bing.com/';
        }
    }

    const isHeadless = options?.headless !== false;

    const browser = await chromium.launch({
        headless: isHeadless,
        slowMo: isHeadless ? 0 : 100, // Slow down interactions in headful mode for realism
        args: [
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    const context = await browser.newContext({
        userAgent,
        javaScriptEnabled: options?.jsEnabled !== false,
        extraHTTPHeaders: extraHeaders,
        viewport: { width: 1920, height: 1080 },
        proxy: options?.proxy
    });

    const page = await context.newPage();

    // --- Phase 4: Ultimate Akamai Bypass (Advanced JS Fingerprinting) ---
    await page.addInitScript(() => {
        // 1. Webdriver evasion (Standard)
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

        // 2. Mock Chrome Object (Advanced)
        (window as any).chrome = {
            runtime: {},
            loadTimes: function () { },
            csi: function () { },
            app: {}
        };

        // 3. Hardware & Environment Mocking (Critical for Fingerprinting)
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // Mock Screen resolution uniformity
        const screenProps = {
            width: 1920,
            height: 1080,
            availWidth: 1920,
            availHeight: 1040,
            colorDepth: 24,
            pixelDepth: 24
        };
        Object.entries(screenProps).forEach(([prop, val]) => {
            Object.defineProperty(window.screen, prop, { get: () => val });
        });

        // 4. Plugins & MimeTypes
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Google Chrome PDF Viewer' },
                { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Microsoft Edge PDF Viewer' }
            ]
        });

        // 5. Languages & Platform
        Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

        // 6. WebGL / Hardware
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
            // Mock high-end renderer info to avoid default headless leaks
            if (parameter === 37445) return 'Google Inc. (Intel)'; // UNMASKED_VENDOR_WEBGL
            if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)'; // UNMASKED_RENDERER_WEBGL
            return getParameter.apply(this, [parameter]);
        };

        // 7. Permissions API
        const originalQuery = window.navigator.permissions.query;
        (window.navigator.permissions as any).query = (parameters: any) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
    });

    let data: ExtractedData = { status: ExtractionStatus.TIMEOUT };
    try {
        // Randomize initial delay
        await page.waitForTimeout(1000 + Math.random() * 2000);

        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

        // Capture telemetry
        const statusCode = response?.status();
        const finalUrl = page.url();
        const pageTitle = await page.title().catch(() => '');

        // Randomized stabilization wait
        await page.waitForTimeout(3000 + Math.random() * 2000);

        const html = await page.content();

        if (domain.includes('amazon')) {
            data = await extractAmazon(page as any);
        } else if (domain.includes('trendyol')) {
            data = await extractTrendyol(url, html);
        } else if (domain.includes('hepsiburada')) {
            data = await extractHepsiburada(page as any, url);
        } else {
            data = await extractGeneric(page as any);
        }

        // Merge telemetry if not already set by specific extractor
        data.statusCode = data.statusCode || statusCode;
        data.finalUrl = data.finalUrl || finalUrl;
        data.pageTitle = data.pageTitle || pageTitle;

        if (statusCode === 404) {
            data.status = ExtractionStatus.PRODUCT_NOT_FOUND;
        }

        if (data && data.status === ExtractionStatus.SUCCESS) {
            // Keep raw html for the diff
            const normalizedBody = await page.evaluate(() => document.body.innerText).catch(() => '');
            data.rawHtml = normalizedBody || html;
        } else if (data && data.status !== ExtractionStatus.SUCCESS) {
            // Save a snippet of the page for debugging failures
            data.rawHtmlSnippet = html.slice(0, 5000);
        }

    } catch (e: any) {
        console.error('Extraction error on', url, e);
        data = {
            status: ExtractionStatus.TIMEOUT,
            failureReason: e.message || 'Unknown error during extraction'
        }
    } finally {
        // Save local debug artifacts if productId is present
        if (options && options.productId && data) {
            try {
                const artifactsDir = path.resolve(process.cwd(), 'logs', 'scrape_artifacts', options.productId.toString());
                if (!fs.existsSync(artifactsDir)) {
                    fs.mkdirSync(artifactsDir, { recursive: true });
                }
                const time = Date.now();

                // Save Screenshot
                const screenshotPath = path.join(artifactsDir, `${time}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

                // Save JSON
                const jsonPath = path.join(artifactsDir, `${time}.json`);
                fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

                // Save Raw HTML
                const htmlPath = path.join(artifactsDir, `${time}.html`);
                const rawHtml = await page.content().catch(() => '');
                fs.writeFileSync(htmlPath, rawHtml);

                console.log(`Saved scrape artifacts to ${artifactsDir}`);
            } catch (artifactErr) {
                console.error("Failed saving artifacts:", artifactErr);
            }
        }

        await browser.close();
    }

    return data;
}
