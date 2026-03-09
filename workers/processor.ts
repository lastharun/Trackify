import { extractProductData, ExtractionStatus } from '../extractors/index';
import { db } from '../database/index';
import { getRandomProxy } from '../utils/proxy-fetcher';
import DiffMatchPatch from 'diff-match-patch';
import fs from 'fs';
import path from 'path';
import { notifyChange } from '../notifications/index';

const dmp = new DiffMatchPatch();

function parseSelectorValue(value: any) {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
    if (!value) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
        } catch { }
    }
    return raw.split(/\r?\n|,/).map((part) => part.trim()).filter(Boolean);
}

function getSelectorDetails(product: any, selector: string | null, role: 'primary' | 'secondary') {
    const primary = String(product.selector_price || '').trim();
    const secondarySelectors = parseSelectorValue(product.selector_secondary);
    const allSelectors = [primary, ...secondarySelectors].filter(Boolean);
    const resolvedSelector = String(selector || '').trim() || (role === 'primary' ? primary : '');
    const overallIndex = resolvedSelector ? allSelectors.indexOf(resolvedSelector) + 1 : 0;
    const secondaryIndex = resolvedSelector ? secondarySelectors.indexOf(resolvedSelector) + 1 : 0;

    return JSON.stringify({
        role,
        selector: resolvedSelector || null,
        css_index: overallIndex > 0 ? overallIndex : null,
        secondary_index: role === 'secondary' && secondaryIndex > 0 ? secondaryIndex : null
    });
}

export async function processProduct(product: any) {
    console.log(`Extracting data for ${product.domain} - ${product.url}`);

    // Call the Playwright/Patchright scraping function
    let data = await extractProductData(product.url, product.domain, { productId: product.id });

    // --- Phase 11: Headful Mouse Bot Fallback (Hepsiburada only) ---
    if (product.domain.includes('hepsiburada') && data.status === ExtractionStatus.WAF_BLOCKED) {
        console.log(`[Hepsiburada Blocked] Final Stand: Launching Headful Mouse Bot...`);
        data = await extractProductData(product.url, product.domain, {
            productId: product.id,
            headless: false
        });
    }

    if (!data) {
        console.error('Failed to extract data for', product.url);
        return;
    }

    if (!data) {
        console.error('Failed to extract data for', product.url);
        return;
    }

    await handleExtractionResult(product, data);
}

export async function handleExtractionResult(product: any, data: any) {
    const normalizedValueType = product.value_type || 'string';
    const shouldTrackPriceSignals = normalizedValueType === 'price';

    // Step 1: Update Telemetry on the Product Row
    const isSuccess = data.status === 'SUCCESS';
    const nextRetryAt = !isSuccess
        ? `datetime('now', '+${Math.min(60, Math.pow(2, (product.retry_count || 0) + 1))} minutes')`
        : 'NULL';

    // Auto-disable product if it fails too many times and "never_stop" is false
    const failureThreshold = 10;
    const currentRetryCount = isSuccess ? 0 : (product.retry_count || 0) + 1;
    const shouldDisable = !isSuccess && currentRetryCount >= failureThreshold && !product.never_stop;

    db.prepare(`
        UPDATE products 
        SET last_extraction_status = ?, 
            last_failure_reason = ?, 
            title = COALESCE(?, title),
            last_price = COALESCE(?, last_price),
            last_value = CASE WHEN ? IS NOT NULL THEN ? ELSE last_value END,
            last_image_url = COALESCE(?, last_image_url),
            last_status_code = ?,
            last_final_url = ?,
            last_page_title = ?,
            retry_count = ?,
            next_check_at = ${nextRetryAt},
            is_active = CASE WHEN ? = 1 THEN 0 ELSE is_active END,
            last_checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        data.status,
        data.failureReason || null,
        data.title || null,
        data.price || null,
        data.value !== undefined ? data.value : null,
        data.value !== undefined ? data.value : null,
        data.image || null,
        data.statusCode || null,
        data.finalUrl || null,
        data.pageTitle || null,
        currentRetryCount,
        shouldDisable ? 1 : 0,
        product.id
    );

    // Record to scrape_logs
    try {
        db.prepare(`
            INSERT INTO scrape_logs (
                product_id, status, status_code, failure_reason, 
                final_url, page_title, html_snippet, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
            product.id,
            data.status,
            data.statusCode || null,
            data.failureReason || null,
            data.finalUrl || null,
            data.pageTitle || null,
            data.rawHtmlSnippet || null
        );
    } catch (logErr) {
        console.error("Failed to insert scrape log:", logErr);
    }

    // ─── Universal Value Change Tracker (CSS Selector Tracking) ─────────────────
    // This is the PRIMARY notification mechanism for element-based tracking.
    // We always compare last_value vs new value — price detection is optional.
    if (data.value !== undefined && data.value !== null) {
        const oldValue = (product.last_value ?? '').trim();
        const newValue = (data.value ?? '').trim();

        if (oldValue !== newValue) {
            const wasEmpty = oldValue === '';
            const isNowEmpty = newValue === '';
            const changeType = isNowEmpty ? 'ELEMENT_GONE' : wasEmpty ? 'ELEMENT_APPEARED' : 'VALUE';
            const isBaseline = wasEmpty;
            const trackAsGenericValue = !shouldTrackPriceSignals;

            console.log(`[${changeType}] Product ${product.id}: "${oldValue.substring(0, 50)}" → "${newValue.substring(0, 50)}"`);

            // First capture is baseline. Skip notifications/log noise on initial add.
            if (!isBaseline && trackAsGenericValue) {
                db.prepare('INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value, details_json) VALUES (?, ?, ?, ?, ?, ?)').run(
                    product.id,
                    changeType,
                    product.selector_price || 'last_value',
                    oldValue,
                    newValue,
                    getSelectorDetails(product, product.selector_price || null, 'primary')
                );

                if (product.notification_telegram) {
                    await notifyChange(product, changeType, 'last_value', oldValue, newValue);
                }

                (data as any).__valueChanged = true;
                (data as any).__notificationMsg = `📌 ${(product.title || product.url || '').substring(0, 50)}\n⚡ Şimdiki: ${newValue.substring(0, 80)}\n🕘 Önceki: ${oldValue.substring(0, 80)}`;
            }
        }
    }

    // If blocked or extremely broken, do not record stock changes. Just exit early.
    if (data.status === 'WAF_BLOCKED' || data.status === 'TIMEOUT' || data.status === 'CONSENT_BLOCKED') {
        console.warn(`Extraction halted for ${product.url} due to block: ${data.status} - ${data.failureReason}`);
        return;
    }

    // Process Price
    if (shouldTrackPriceSignals && data.price !== undefined && data.price !== null) {
        const lastPriceRecord = db.prepare('SELECT price, original_price, discounted_price FROM price_history WHERE product_id = ? ORDER BY timestamp DESC LIMIT 1').get(product.id) as any;
        const isInitialPriceCapture = !lastPriceRecord;

        const hasPriceChanged = !lastPriceRecord || lastPriceRecord.price !== data.price;
        const hasOriginalChanged = data.originalPrice !== undefined && lastPriceRecord?.original_price !== data.originalPrice;
        const hasDiscountedChanged = data.discountedPrice !== undefined && lastPriceRecord?.discounted_price !== data.discountedPrice;

        if (hasPriceChanged || hasOriginalChanged || hasDiscountedChanged) {
            console.log(`Price change detected for ${product.id}`);
            if (hasPriceChanged) console.log(`  Main: ${lastPriceRecord?.price} -> ${data.price}`);
            if (hasOriginalChanged) console.log(`  Original: ${lastPriceRecord?.original_price} -> ${data.originalPrice}`);
            if (hasDiscountedChanged) console.log(`  Discounted: ${lastPriceRecord?.discounted_price} -> ${data.discountedPrice}`);

            db.prepare('INSERT INTO price_history (product_id, price, original_price, discounted_price, currency) VALUES (?, ?, ?, ?, ?)').run(
                product.id,
                data.price,
                data.originalPrice || null,
                data.discountedPrice || null,
                data.currency || 'TL'
            );

            // Create change log for the primary price change
            if (!isInitialPriceCapture && hasPriceChanged) {
                db.prepare('INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?)').run(
                    product.id, 'PRICE', 'price', lastPriceRecord?.price?.toString() || '', data.price.toString()
                );
            }

            // Notify with all relevant price info
            const shouldNotify = () => {
                const cond = product.alert_condition_type || 'all';
                const condValue = (product.alert_condition_value || '').toString().trim();

                if (cond === 'all') return true;
                if (cond === '↓') return data.price < (lastPriceRecord?.price || Infinity);
                if (cond === '↑') return data.price > (lastPriceRecord?.price || 0);

                const numValue = parseFloat(condValue);
                if (cond === '<') return !isNaN(numValue) && data.price < numValue;
                if (cond === '>') return !isNaN(numValue) && data.price > numValue;
                if (cond === '<min') return data.price <= (product.min_price ?? data.price);
                if (cond === '>max') return data.price >= (product.max_price ?? data.price);

                // 'includes': check if the current VALUE (text) contains the keyword
                if (cond === 'includes') {
                    const keyword = condValue.toLowerCase();
                    if (!keyword) return true;
                    const checkVal = (data.value || data.price?.toString() || '').toLowerCase();
                    return checkVal.includes(keyword);
                }

                return true;
            };

            if (!isInitialPriceCapture && hasPriceChanged && shouldNotify()) {
                if (product.notification_telegram) {
                    await notifyChange(product, 'PRICE', 'price', lastPriceRecord?.price?.toString() || '', data.price.toString(), {
                        originalPrice: data.originalPrice,
                        discountedPrice: data.discountedPrice,
                        oldOriginalPrice: lastPriceRecord?.original_price,
                        oldDiscountedPrice: lastPriceRecord?.discounted_price
                    });
                }
                // Browser notification logic would go here if implemented via push/storage
            }
        }
    }

    // Process Stock
    if (shouldTrackPriceSignals && data.stock_status !== undefined) {
        const isStock = data.stock_status ? 1 : 0;
        const lastStock = db.prepare('SELECT is_in_stock FROM stock_history WHERE product_id = ? ORDER BY timestamp DESC LIMIT 1').get(product.id) as any;
        if (!lastStock) {
            db.prepare('INSERT INTO stock_history (product_id, is_in_stock) VALUES (?, ?)').run(product.id, isStock);
        } else if (lastStock.is_in_stock !== isStock) {
            console.log(`Stock change detected: ${lastStock?.is_in_stock} -> ${isStock}`);
            db.prepare('INSERT INTO stock_history (product_id, is_in_stock) VALUES (?, ?)').run(product.id, isStock);
            db.prepare('INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?)').run(
                product.id, 'STOCK', 'is_in_stock', lastStock?.is_in_stock?.toString() || '', isStock.toString()
            );
            if (product.notification_telegram) {
                await notifyChange(product, 'STOCK', 'is_in_stock', lastStock?.is_in_stock?.toString() || '', isStock.toString());
            }
        }
    }

    // Save snapshot and check content diff
    if (data.rawHtml) {
        const snapshotsDir = path.resolve(__dirname, '../snapshots', product.id.toString());
        if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });

        const filename = `${Date.now()}.html`;
        const filepath = path.join(snapshotsDir, filename);
        fs.writeFileSync(filepath, data.rawHtml);

        const lastSnapshot = db.prepare('SELECT * FROM snapshots WHERE product_id = ? ORDER BY created_at DESC LIMIT 1').get(product.id) as any;

        // Insert new snapshot including Phase 2 normalized columns
        const snapInfo = db.prepare(`
            INSERT INTO snapshots (product_id, file_path, delivery_text, images, description, other_sellers) 
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            product.id,
            filepath,
            data.delivery_text || null,
            data.images ? JSON.stringify(data.images) : null,
            data.description || null,
            data.other_sellers ? JSON.stringify(data.other_sellers) : null
        );

        if (lastSnapshot) {
            try {
                const oldHtml = fs.readFileSync(lastSnapshot.file_path, 'utf8');
                // Extremely simple length check diff to avoid huge text diffs in console
                // Silencing minor HTML length changes as per user request
                /*
                if (oldHtml.length !== data.rawHtml.length) {
                    db.prepare('INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value, snapshot_id) VALUES (?, ?, ?, ?, ?, ?)').run(
                        product.id, 'CONTENT', 'html_length', oldHtml.length.toString(), data.rawHtml.length.toString(), snapInfo.lastInsertRowid
                    );
                }
                */
            } catch (e) {
                console.error('Error comparing snapshots', e);
            }
        }
    }
}
