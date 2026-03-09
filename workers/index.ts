import cron from 'node-cron';
import dotenv from 'dotenv';
import { db, initDb } from '../database/index';
import { processProduct } from './processor';

dotenv.config();
import { isNotificationsEnabled } from '../backend/remote_control';

// Initialize DB for worker if needed
try {
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").get();
    if (!tableCheck) initDb();
} catch (e) {
    console.error(e);
}

// Queue system state
let isProcessing = false;

// Run every minute and check what needs to be updated
cron.schedule('* * * * *', async () => {
    if (isProcessing) {
        console.log('Worker is currently processing previous queue, skipping this minute...');
        return;
    }

    console.log(`[${new Date().toISOString()}] Worker waking up to check for products...`);
    isProcessing = true;

    try {
        // Updated query: Use next_check_at if set, otherwise fallback to tracking_interval logic.
        // IMPORTANT: Skip products with selector_price — those are handled exclusively by the
        // browser extension via GET /api/extension/tasks + POST /api/extension/sync.
        const query = `
            SELECT * FROM products 
            WHERE is_active = 1
            AND (selector_price IS NULL OR selector_price = '')  -- Extension-tracked products skip backend extractor
            AND domain != 'hepsiburada'                          -- Hepsiburada is extension-only
            AND (
                (next_check_at IS NULL AND (
                    last_checked_at IS NULL 
                    OR (julianday('now') - julianday(last_checked_at)) * 24 * 60 >= tracking_interval
                ))
                OR (next_check_at IS NOT NULL AND next_check_at <= CURRENT_TIMESTAMP)
            )
            ORDER BY domain ASC
        `;

        let productsToProcess = db.prepare(query).all() as any[];

        if (productsToProcess.length > 0) {
            console.log(`Found ${productsToProcess.length} products to check.`);

            // Shuffle slightly to interleave different domains
            productsToProcess = productsToProcess.sort(() => Math.random() - 0.5);

            for (const product of productsToProcess) {
                console.log(`[Queue] Processing product ${product.id} (${product.domain})`);
                try {
                    await processProduct(product);

                    // Small delay between ANY two products to be polite
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } catch (err) {
                    console.error(`Error processing product ${product.id}:`, err);
                }
            }
        }
    } catch (error) {
        console.error('Error in cron job', error);
    } finally {
        isProcessing = false;
        console.log('Cron finished execution.');
    }
});

console.log('Worker started. Waiting for schedule...');
