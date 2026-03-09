/**
 * Price Tracker — Content Script
 * Handles auto-detection and manual element selection.
 */
(() => {
    const root = typeof window !== 'undefined' ? window : globalThis;
    if (root.__TRACKIFY_CONTENT_LOADED__) return;
    root.__TRACKIFY_CONTENT_LOADED__ = true;

// ─── Auto-Detection ──────────────────────────────────────────────────────────

function autoDetectPrice() {
    // Hepsiburada: `default-price` is the MAIN buy-box price (e.g. 579,90 TL).
    // `price-current-price` appears in "Diğer satıcılar" blocks — DO NOT use it as primary.
    const hbMainPriceSels = [
        '[data-test-id="default-price"] span',
        '[data-test-id="default-price"]',
    ];
    for (const sel of hbMainPriceSels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const raw = el.innerText || el.textContent || '';
        const price = parsePrice(raw, el);
        if (price && price > 0 && price < 10000000) return { price, selector: sel, element: el };
    }

    // Generic selectors — sorted from most specific to broadest
    const priceSelectors = [
        '[itemprop="price"]',
        '.prc-dsc',                              // Trendyol
        '.a-price-whole',                        // Amazon
        'meta[property="product:price:amount"]',
        '[data-testid*="price"]',
        '[class*="price"]', '[class*="Price"]',
        '[id*="price"]', '[id*="Price"]',
    ];
    for (const sel of priceSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const raw = el.tagName === 'META' ? el.getAttribute('content') : el.innerText;
        if (!raw) continue;
        const price = parsePrice(raw, el);
        if (price && price > 0 && price < 10000000) return { price, selector: sel, element: el };
    }
    return null;
}

function autoDetectTitle() {
    const el = document.querySelector('h1');
    return el ? el.innerText.trim().substring(0, 120) : document.title.substring(0, 120);
}

function autoDetectImage() {
    const og = document.querySelector('meta[property="og:image"]')?.content;
    if (og && og.startsWith('http')) return og;
    const commonSelectors = [
        '#main-image', '#imgBlkFront', '#landingImage',
        '.product-image-container img', '.product-detail-hero img',
        '.sp-image', '.main-product-img', '[data-test-id="product-image"]'
    ];
    for (const s of commonSelectors) {
        const img = document.querySelector(s);
        if (img && img.src && img.src.startsWith('http')) return img.src;
    }
    const imgs = [...document.getElementsByTagName('img')].map(i => {
        const r = i.getBoundingClientRect();
        return { src: i.src, area: r.width * r.height };
    }).filter(i => i.src && i.src.startsWith('http') && !i.src.includes('favicon') && !i.src.includes('logo'));
    imgs.sort((a, b) => b.area - a.area);
    return imgs[0]?.src || null;
}

function parsePrice(text, element = null) {
    if (!text) return null;
    if (element) {
        const context = (element.className + ' ' + (element.parentElement?.className || '') + ' ' + (element.id || '')).toLowerCase();
        const keywords = ['rating', 'puan', 'score', 'star', 'degerlendirme', 'yorum', 'comment'];
        if (keywords.some(k => context.includes(k))) return null;
    }
    const noSpaceText = text.toString().replace(/\s+/g, '');
    const match = noSpaceText.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/);
    if (!match) return null;
    const rawMatch = match[0];
    const isSmall = parseFloat(rawMatch.replace(',', '.')) < 10;
    const hasCurrency = /TL|TRY|₺|\$|€|£/i.test(noSpaceText);
    if (isSmall && !hasCurrency) return null;
    const cleaned = rawMatch.replace(/\.(?=\d{3}[,])/g, '').replace(/,(?=\d{3}[.])/g, '').replace(/[^\d.,]/g, '');
    const lastSeparatorPos = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
    let finalString = cleaned;
    if (lastSeparatorPos > -1) {
        const intPart = cleaned.substring(0, lastSeparatorPos).replace(/[.,]/g, '');
        const decPart = cleaned.substring(lastSeparatorPos + 1);
        finalString = intPart + '.' + decPart;
    }
    const num = parseFloat(finalString);
    return isNaN(num) ? null : num;
}

function normalizeExtractedText(values) {
    const seen = new Set();
    const cleaned = [];

    for (const value of values) {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        cleaned.push(normalized);
    }

    return cleaned.join(' ').replace(/\s+/g, ' ').trim();
}

function findPreferredTextElement(el) {
    if (!el || el.tagName === 'IMG') return el;

    const amazonFocused =
        el.matches?.('#fod-cx-message-with-learn-more, [id^="fod-cx-message"]')
            ? el
            : el.querySelector?.('#fod-cx-message-with-learn-more, [id^="fod-cx-message"]');
    if (amazonFocused) return amazonFocused;

    return el;
}

function extractTextValue(el) {
    if (!el) return '';
    if (el.tagName === 'IMG') return el.src || el.getAttribute('data-src') || '';

    const target = findPreferredTextElement(el);
    const clone = target.cloneNode(true);
    clone.querySelectorAll?.('.a-popover-preload, script, style, noscript, template, [hidden]').forEach((node) => node.remove());

    let raw = (clone.innerText || target.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
    raw = raw.replace(/\s+/g, ' ').trim();

    return raw;
}

function inferValueTypeFromText(value) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 'string';

    const stripped = normalized
        .replace(/(?:try|tl|usd|eur|gbp)/gi, '')
        .replace(/[0-9.,%+\-_/\\()[\]{}:;"'`~|!?@#$^&*=<>₺$€£¥₹\s]/g, '')
        .trim();

    return stripped ? 'string' : 'price';
}

let isInSelectionMode = false;
function startSelectionMode(type, callback) {
    if (isInSelectionMode) return;
    isInSelectionMode = true;
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
        border: '2px solid #ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
        boxSizing: 'border-box', display: 'none', borderRadius: '4px',
        transition: 'all 0.05s'
    });
    document.body.appendChild(overlay);
    const infoBar = document.createElement('div');
    infoBar.id = '__pt_infobar__';
    Object.assign(infoBar.style, {
        position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '2147483647',
        background: '#0f172a', color: '#f8fafc', padding: '10px 20px',
        fontSize: '13px', fontFamily: 'sans-serif', display: 'flex',
        alignItems: 'center', gap: '16px', borderTop: '2px solid #ef4444'
    });
    const label = type === 'price' ? '💰 Fiyat' : (type === 'title' ? '📝 Başlık' : (type === 'image' ? '🖼️ Görsel' : '🎯 Alan'));
    infoBar.innerHTML = `
        <div style="background:#ef4444;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:11px">SEÇ</div>
        <span style="font-weight:bold;color:#ef4444">${label} Seçin:</span>
        <span style="opacity:0.7">İmleci elementin üzerine getirin ve tıklayın.</span>
        <span id="__pt_val__" style="margin-left:auto;font-family:monospace;background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        <button id="__pt_cancel__" style="background:none;border:1px solid #64748b;color:#64748b;padding:4px 10px;border-radius:4px;cursor:pointer;flex-shrink:0">İptal [Esc]</button>
    `;
    document.body.appendChild(infoBar);
    document.getElementById('__pt_cancel__').onclick = stopSelectionMode;
    function onMouseMove(e) {
        if (!isInSelectionMode) return;
        let el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el.id === '__pt_infobar__' || el.closest('#__pt_infobar__')) return;
        if (type === 'image' && el.tagName !== 'IMG') {
            const innerImg = el.querySelector('img');
            if (innerImg) el = innerImg;
        }
        const r = el.getBoundingClientRect();
        Object.assign(overlay.style, { display: 'block', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
        const val = el.tagName === 'IMG' ? el.src : extractTextValue(el).substring(0, 80);
        const valEl = document.getElementById('__pt_val__');
        if (valEl) valEl.textContent = val || 'Boş';
    }
    function onClick(e) {
        if (!isInSelectionMode) return;
        let el = e.target;
        if (!el || el.id === '__pt_infobar__' || el.closest('#__pt_infobar__')) return;
        e.preventDefault(); e.stopPropagation();
        if (type === 'image' && el.tagName !== 'IMG') {
            const innerImg = el.querySelector('img');
            if (innerImg) el = innerImg;
        }
        const selector = getBestSelector(el);
        const value = el.tagName === 'IMG' ? el.src : extractTextValue(el);
        stopSelectionMode();
        callback({ type, selector, value });
    }
    function onKeyDown(e) { if (e.key === 'Escape') stopSelectionMode(); }
    function stopSelectionMode() {
        isInSelectionMode = false;
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove(); infoBar.remove();
    }
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
}

function getBestSelector(el) {
    el = findPreferredTextElement(el);
    if (el.id) return '#' + CSS.escape(el.id);

    // 1. Data Test ID
    const attr = el.hasAttribute('data-test-id') ? 'data-test-id' : (el.hasAttribute('data-testid') ? 'data-testid' : null);
    if (attr) {
        const val = el.getAttribute(attr);
        const sel = `[${attr}="${val}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // 2. Other common semantic attributes
    for (const a of ['itemprop', 'data-qa', 'name']) {
        if (el.hasAttribute(a)) {
            const sel = `[${a}="${el.getAttribute(a)}"]`;
            if (document.querySelectorAll(sel).length === 1) return sel;
        }
    }

    // 3. Exact full class match
    if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).filter(c => c.length > 3 && !c.match(/^\d/) && !c.includes(':'));
        if (classes.length > 0) {
            const sel = `${el.tagName.toLowerCase()}.${classes.map(CSS.escape).join('.')}`;
            if (document.querySelectorAll(sel).length === 1) return sel;
        }

        // Try individual classes
        for (const cls of classes) {
            const sel = `${el.tagName.toLowerCase()}.${CSS.escape(cls)}`;
            if (document.querySelectorAll(sel).length === 1) return sel;
        }
    }
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 5) {
        let part = cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className === 'string') {
            const bestClass = cur.className.trim().split(/\s+/).find(c => c.length > 4);
            if (bestClass) part += '.' + CSS.escape(bestClass);
        }
        const siblings = cur.parentElement ? Array.from(cur.parentElement.children).filter(e => e.tagName === cur.tagName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        parts.unshift(part);
        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
        cur = cur.parentElement;
    }
    return parts.join(' > ');
}

function showToast(message) {
    const t = document.createElement('div');
    Object.assign(t.style, {
        position: 'fixed', bottom: '60px', left: '50%', transform: 'translateX(-50%)',
        background: '#10b981', color: '#fff', padding: '10px 20px', borderRadius: '8px',
        zIndex: '2147483647', fontFamily: 'sans-serif', fontSize: '14px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
    });
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function startGuidedTracking() {
    const result = {};
    const stepPrice = () => {
        // startGuidedTracking starts with selecting an element directly without auto-detecting price
        startSelectionMode('pick', ({ selector, value }) => {
            result.selector_price = selector;
            result.price_value = value;
            result.value_type = inferValueTypeFromText(value);
            showToast('🎯 Alan seçildi! Şimdi başlığı seçin.');
            setTimeout(stepTitle, 600);
        });
    };
    const stepTitle = () => {
        startSelectionMode('title', ({ selector, value }) => {
            result.selector_title = selector; result.title_value = value;
            showToast('📝 Başlık seçildi! Şimdi görseli seçin.');
            setTimeout(stepImage, 600);
        });
    };
    const stepImage = () => {
        startSelectionMode('image', ({ selector, value }) => {
            result.selector_image = selector; result.image_value = value;
            chrome.runtime.sendMessage({
                action: 'add_product', data: result, url: window.location.href,
                domain: window.location.hostname.replace('www.', '').split('.')[0],
                title: result.title_value || document.title
            });
        });
    };
    stepPrice();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrape') {
        const selectors = request.selectors || {};
        const priceEl = selectors.price ? document.querySelector(selectors.price) : null;
        const titleEl = selectors.title ? document.querySelector(selectors.title) : null;
        const imageEl = selectors.image ? document.querySelector(selectors.image) : null;
        const priceText = priceEl ? (priceEl.innerText || priceEl.getAttribute('content')) : null;
        const price = parsePrice(priceText, priceEl) || parsePrice(autoDetectPrice()?.price);
        sendResponse({
            price, title: (titleEl ? titleEl.innerText?.trim() : null) || autoDetectTitle(),
            image: (imageEl ? imageEl.src : null) || autoDetectImage(), url: window.location.href
        });
        return true;
    }
    if (request.action === 'get_page_info') {
        const detected = autoDetectPrice();
        sendResponse({
            detectedPrice: detected?.price || null, detectedSelector: detected?.selector || null,
            title: autoDetectTitle(), image: autoDetectImage(), url: window.location.href,
            domain: window.location.hostname.replace('www.', '').split('.')[0]
        });
        return true;
    }
    if (request.action === 'start_selection') { startGuidedTracking(); sendResponse({ success: true }); return true; }
    if (request.action === 'show_toast') { showToast(request.message); sendResponse({ success: true }); return true; }
    if (request.action === 'test_selector') {
        try {
            const el = document.querySelector(request.selector);
            if (!el) sendResponse({ found: false });
            else {
                const raw = el.tagName === 'IMG'
                    ? el.src
                    : normalizeExtractedText([extractTextValue(el)]);
                sendResponse({ found: true, value: raw, value_type: inferValueTypeFromText(raw) });
            }
        } catch { sendResponse({ found: false, error: 'Invalid selector' }); }
        return true;
    }
    if (request.action === 'pick_element') {
        const target = request.target || 'unified';
        startSelectionMode('pick', ({ selector, value }) => {
            const imageUrl = autoDetectImage();
            const valueType = inferValueTypeFromText(value);
            const isPriceLike = valueType === 'price';

            const payloadData = {
                title_value: document.title,
                image_url: imageUrl,
                value_type: valueType
            };

            // If unified, we set selector_price. If the user picks another one later, 
            // the backend/frontend logic will append it to secondary.
            if (target === 'price' || target === 'unified') {
                payloadData.selector_price = selector;
            } else {
                payloadData.selector_secondary = selector;
            }

            chrome.runtime.sendMessage({
                action: 'add_product', data: payloadData,
                url: window.location.href, domain: window.location.hostname.replace('www.', '').split('.')[0], title: document.title
            }, (response) => {
                if (response?.success) {
                    showToast(isPriceLike ? '✅ Fiyat alanı takibe alındı!' : '🎯 Alan takibe alındı!');
                }
            });
        });
        sendResponse({ success: true }); return true;
    }
    if (request.action === 'pick_image') {
        startSelectionMode('image', ({ value }) => {
            chrome.runtime.sendMessage({ action: 'update_product_image', productId: request.productId, imageUrl: value });
            showToast('✅ Ürün görseli güncellendi!');
        });
        sendResponse({ success: true }); return true;
    }
    if (request.action === 'extract_element') {
        const { selector, selectorTitle, selectorImage } = request;
        const expectPrice = request.expectPrice === true;
        let elementFound = false; let rawValue = ''; let price = null;
        if (selector) {
            try {
                const els = document.querySelectorAll(selector);
                if (els.length > 0) {
                    elementFound = true; let values = [];
                    els.forEach(el => {
                        let text = el.tagName === 'IMG'
                            ? (el.src || el.getAttribute('data-src') || '')
                            : extractTextValue(el) || el.getAttribute('content') || '';
                        text = text.trim(); if (text) values.push(text);
                    });
                    rawValue = normalizeExtractedText(values);
                    if (expectPrice) {
                        price = parsePrice(rawValue, els[0]);
                        if (price === null) { for (const v of values) { price = parsePrice(v, els[0]); if (price !== null) break; } }
                    }
                }
            } catch (e) { }
        }
        if (expectPrice && !selector && (!elementFound || !rawValue)) {
            const detected = autoDetectPrice();
            if (detected && detected.price) {
                elementFound = true;
                price = parsePrice(detected.price, detected.element);
                rawValue = normalizeExtractedText([detected.price]);
            }
        }
        sendResponse({
            elementFound, value: rawValue, price,
            title: selectorTitle ? (document.querySelector(selectorTitle)?.innerText?.trim() || document.title) : document.title,
            image: selectorImage ? (document.querySelector(selectorImage)?.src || null) : autoDetectImage(), url: window.location.href
        });
        return true;
    }
    if (request.action === 'scan_page') {
        const domain = window.location.hostname.replace('www.', '');
        const isAmazon = domain.includes('amazon');
        const isHepsi = domain.includes('hepsiburada');
        const isTrendyol = domain.includes('trendyol');

        const SCAN_MAP = [
            // ── Amazon (sadece amazon.com.tr) ────────────────────────────────────
            ...(isAmazon ? [
                { category: '💰 Amazon Fiyat', label: 'Ana Fiyat', selectors: ['#price_inside_buybox', '#newBuyBoxPrice', '.priceToPay', '.a-price .a-offscreen', '.a-price-whole'] },
                { category: '💰 Amazon Fiyat', label: 'Sepete Özel Fiyat', selectors: ['.ulpBadgePrice', '#qualifiedBuybox .a-price .a-offscreen', '[data-csa-c-type="cartPrice"]'] },
                { category: '💰 Amazon Fiyat', label: 'Çizili Liste Fiyatı', selectors: ['.a-text-strike', '.a-price[data-a-strike] .a-offscreen'] },
                { category: '📦 Amazon Stok', label: 'Stok Durumu', selectors: ['#availability', '#availability span', '#availability .a-color-success'] },
                { category: '🏪 Amazon Satıcı', label: 'Satıcı', selectors: ['#merchant-info', '#soldByThirdParty', '#sellerProfileTriggerId'] },
                { category: '🎯 Amazon Buy Box', label: 'Kargo Bilgisi', selectors: ['#price-shipping-message', '#dynamicDeliveryMessage', '#ddmDeliveryMessage'] },
                { category: 'ℹ️ Amazon Bilgi', label: 'Ürün Başlığı', selectors: ['#productTitle'] },
            ] : []),

            // ── Hepsiburada (sadece hepsiburada.com) ──────────────────────────────
            ...(isHepsi ? [
                // `default-price` → buy-box fiyatı (asıl fiyat)
                // `price-current-price` → "Diğer satıcılar"daki fiyat
                { category: '💰 HB Fiyat', label: 'Ana Fiyat (Buy Box)', selectors: ['[data-test-id="default-price"]', '[data-test-id="default-price"] span', '.price-value', '#offering-price'] },
                { category: '💰 HB Fiyat', label: 'Sepete Özel Fiyat', selectors: ['[data-test-id="price-basket"]', '[class*="basketPrice"]'] },
                { category: '💰 HB Fiyat', label: 'Çizili / Eski Fiyat', selectors: ['[data-test-id="price-original"]', '.price-old-price', '[class*="oldPrice"]', '[class*="OriginalPrice"]'] },
                { category: '💰 HB Fiyat', label: 'Diğer Satıcı Fiyatı', selectors: ['[data-test-id="price-current-price"]'] },
                { category: '💰 HB Fiyat', label: 'Taksit Tutarı', selectors: ['[data-test-id="installments"]', '.installment-price', '[class*="installment"]'] },
                { category: '📦 HB Stok', label: 'Stok Durumu', selectors: ['[data-test-id="stock"]', '.stock-status', '[class*="stockStatus"]'] },
                { category: '📦 HB Stok', label: 'Kargo Bilgisi', selectors: ['[data-test-id="shipping"]', '[class*="shippingInfo"]', '.fast-delivery', '[class*="kargoSuresi"]'] },
                { category: '🏪 HB Satıcı', label: 'Satıcı Adı', selectors: ['[data-test-id="merchantName"]', '[class*="merchantName"]', '[class*="sellerName"]', '.merchant-name a'] },
                { category: '🏪 HB Satıcı', label: 'Satıcı Puanı', selectors: ['[data-test-id="merchantRating"]', '[class*="merchantRating"]'] },
                { category: '🛒 HB İşlem', label: 'Sepete Ekle', selectors: ['[data-test-id="addToCart"]', '[class*="addToCart"]', '#addToCart'] },
                { category: '🛒 HB İşlem', label: 'Hemen Al', selectors: ['[data-test-id="buyNow"]', '[data-test-id="buy-now"]'] },
                { category: 'ℹ️ HB Bilgi', label: 'Ürün Başlığı', selectors: ['[data-test-id="title"]', 'h1.product-name', 'h1[class*="productName"]', 'h1'] },
                { category: 'ℹ️ HB Bilgi', label: 'Yıldız Puanı', selectors: ['[data-test-id="rating"]', '[class*="ratingScore"]', '[class*="starRating"]'] },
                { category: 'ℹ️ HB Bilgi', label: 'Yorum Sayısı', selectors: ['[data-test-id="reviewCount"]', '[class*="reviewCount"]', '[class*="commentCount"]'] },
            ] : []),

            // ── Trendyol (sadece trendyol.com) ──────────────────────────────────
            ...(isTrendyol ? [
                { category: '💰 Trendyol Fiyat', label: 'İndirimli Fiyat', selectors: ['.prc-dsc', '[class*="discountedPrice"]'] },
                { category: '💰 Trendyol Fiyat', label: 'Normal / Çizili Fiyat', selectors: ['.prc-org', '[class*="originalPrice"]'] },
                { category: '💰 Trendyol Fiyat', label: 'Sepete Özel (Plus)', selectors: ['[data-testid="price-current"]', '[class*="campaignPrice"]'] },
                { category: '📦 Trendyol Stok', label: 'Stok / Teslimat', selectors: ['[data-test="stock-message"]', '[class*="delivery"]'] },
                { category: '🏪 Trendyol Satıcı', label: 'Satıcı', selectors: ['[class*="seller-name"]', '[class*="merchantStorefront"]'] },
                { category: '🛒 Trendyol İşlem', label: 'Sepete Ekle', selectors: ['[data-testid="addToCart"]', '[class*="add-to-cart"]'] },
                { category: 'ℹ️ Trendyol Bilgi', label: 'Ürün Başlığı', selectors: ['[data-testid="product-name"]', 'h1'] },
                { category: 'ℹ️ Trendyol Bilgi', label: 'Değerlendirme', selectors: ['[data-testid="rating"]', '[class*="rating"]'] },
            ] : []),

            // ── Genel (tüm siteler için) ─────────────────────────────────────────
            { category: '💰 Fiyat', label: 'Genel Fiyat', selectors: ['[itemprop="price"]', '[class*="product-price"]', 'meta[property="product:price:amount"]'] },
            { category: 'ℹ️ Bilgi', label: 'Ürün Başlığı', selectors: ['h1[itemprop="name"]', '[data-testid="product-name"]'] },
        ];

        const results = [];
        for (const item of SCAN_MAP) {
            for (const sel of item.selectors) {
                try {
                    const el = document.querySelector(sel);
                    if (el) {
                        let val = '';
                        if (el.tagName === 'IMG') val = el.src || el.getAttribute('data-src') || '';
                        else val = (el.innerText || el.textContent || '').trim().substring(0, 80);
                        if (val) {
                            results.push({ label: item.label, category: item.category, selector: sel, value: val, hasValue: true });
                            break;
                        }
                    }
                } catch (e) { }
            }
        }
        sendResponse({ results });
        return true;
    }
});

})();
