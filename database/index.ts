import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = process.env.TRACKIFY_DB_DIR
    ? path.resolve(process.env.TRACKIFY_DB_DIR)
    : __dirname;
const dbPath = process.env.TRACKIFY_DB_PATH
    ? path.resolve(process.env.TRACKIFY_DB_PATH)
    : path.join(dbDir, 'ticarettakip.db');
const schemaPath = process.env.TRACKIFY_SCHEMA_PATH
    ? path.resolve(process.env.TRACKIFY_SCHEMA_PATH)
    : path.resolve(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath, {
    verbose: console.log,
    timeout: 5000
});

// Enable foreign keys and WAL mode
try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
} catch (e) {
    console.error('Error setting pragmas:', e);
}

export function initDb() {
    try {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.exec(schema);

        // ── Runtime migrations (safe to run every time) ──────────────────────────
        const migrations = [
            `ALTER TABLE products ADD COLUMN selector_secondary TEXT`,
            `ALTER TABLE products ADD COLUMN last_secondary_value TEXT`,
            `ALTER TABLE products ADD COLUMN last_secondary_map TEXT`,
            `ALTER TABLE change_logs ADD COLUMN details_json TEXT`,
            `ALTER TABLE devices ADD COLUMN device_name TEXT`,
            `ALTER TABLE devices ADD COLUMN platform TEXT`,
            `ALTER TABLE devices ADD COLUMN user_agent TEXT`,
            `ALTER TABLE devices ADD COLUMN extension_version TEXT`,
            `ALTER TABLE devices ADD COLUMN status TEXT DEFAULT 'active'`,
            `ALTER TABLE devices ADD COLUMN blocked_until DATETIME`,
            `ALTER TABLE devices ADD COLUMN reason TEXT`,
            `ALTER TABLE devices ADD COLUMN last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
        ];
        for (const sql of migrations) {
            try { db.prepare(sql).run(); } catch (_) { /* column already exists */ }
        }

        // Initialize settings with defaults if empty
        const settingsCount = db.prepare("SELECT COUNT(*) as count FROM settings").get() as any;
        if (settingsCount.count === 0) {
            db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('telegram_enabled', '1');
            db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('browser_enabled', '1');
        }

        db.prepare("UPDATE products SET last_value = '' WHERE last_value IS NULL").run();
        db.prepare("UPDATE products SET last_secondary_value = '' WHERE last_secondary_value IS NULL").run();
        db.prepare("UPDATE products SET last_secondary_map = '{}' WHERE last_secondary_map IS NULL").run();

        const rows = db.prepare('SELECT id, selector_price, selector_secondary FROM products').all() as Array<{
            id: number;
            selector_price: string | null;
            selector_secondary: string | null;
        }>;
        const normalize = (...values: Array<string | null>) => {
            const seen = new Set<string>();
            const selectors: string[] = [];
            for (const value of values) {
                if (!value) continue;
                for (const part of value.split(',')) {
                    const selector = part.trim();
                    if (!selector || seen.has(selector)) continue;
                    seen.add(selector);
                    selectors.push(selector);
                }
            }
            return selectors;
        };

        const updateSelectors = db.prepare(`
            UPDATE products
            SET selector_price = ?, selector_secondary = ?
            WHERE id = ?
        `);

        for (const row of rows) {
            const selectors = normalize(row.selector_price, row.selector_secondary);
            const selectorPrice = selectors[0] || null;
            const selectorSecondary = selectors.slice(1).join(', ') || null;

            if (selectorPrice !== row.selector_price || selectorSecondary !== row.selector_secondary) {
                updateSelectors.run(selectorPrice, selectorSecondary, row.id);
            }
        }

        const changeRows = db.prepare(`
            SELECT c.id, c.change_type, c.field_changed, p.selector_price, p.selector_secondary
            FROM change_logs c
            JOIN products p ON p.id = c.product_id
            WHERE c.details_json IS NULL
              AND c.change_type IN ('VALUE', 'ELEMENT_APPEARED', 'ELEMENT_GONE', 'SECONDARY')
        `).all() as Array<{
            id: number;
            change_type: string;
            field_changed: string | null;
            selector_price: string | null;
            selector_secondary: string | null;
        }>;

        const updateChangeDetails = db.prepare(`
            UPDATE change_logs
            SET details_json = ?
            WHERE id = ?
        `);

        for (const row of changeRows) {
            const primary = (row.selector_price || '').trim();
            const secondarySelectors = (row.selector_secondary || '')
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean);
            const allSelectors = [primary, ...secondarySelectors].filter(Boolean);

            let selector = (row.field_changed || '').trim();
            let role: 'primary' | 'secondary' = row.change_type === 'SECONDARY' ? 'secondary' : 'primary';

            if (!selector || selector === 'last_value') selector = primary;
            if (selector === 'selector_secondary') selector = secondarySelectors[0] || '';

            const cssIndex = selector ? allSelectors.indexOf(selector) + 1 : 0;
            const secondaryIndex = selector ? secondarySelectors.indexOf(selector) + 1 : 0;

            updateChangeDetails.run(JSON.stringify({
                role,
                selector: selector || null,
                css_index: cssIndex > 0 ? cssIndex : null,
                secondary_index: role === 'secondary' && secondaryIndex > 0 ? secondaryIndex : null
            }), row.id);
        }

        const productsWithSecondaryMap = db.prepare(`
            SELECT id, selector_price, selector_secondary, last_secondary_map, last_checked_at
            FROM products
            WHERE last_secondary_map IS NOT NULL
              AND last_secondary_map != ''
              AND last_secondary_map != '{}'
        `).all() as Array<{
            id: number;
            selector_price: string | null;
            selector_secondary: string | null;
            last_secondary_map: string;
            last_checked_at: string | null;
        }>;

        const existingSecondaryRows = db.prepare(`
            SELECT field_changed, details_json
            FROM change_logs
            WHERE product_id = ?
              AND change_type = 'SECONDARY'
        `);

        const insertSecondaryBaseline = db.prepare(`
            INSERT INTO change_logs (product_id, change_type, field_changed, old_value, new_value, details_json, timestamp)
            VALUES (?, 'SECONDARY', ?, '', ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);

        for (const product of productsWithSecondaryMap) {
            const secondarySelectors = (product.selector_secondary || '')
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean);
            if (!secondarySelectors.length) continue;

            let secondaryMap: Record<string, string> = {};
            try {
                const parsed = JSON.parse(product.last_secondary_map || '{}');
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    secondaryMap = parsed;
                }
            } catch { }

            const seenSelectors = new Set<string>();
            for (const row of existingSecondaryRows.all(product.id) as Array<{ field_changed: string | null; details_json: string | null }>) {
                const fieldSelector = (row.field_changed || '').trim();
                if (fieldSelector && fieldSelector !== 'selector_secondary') seenSelectors.add(fieldSelector);
                try {
                    const details = row.details_json ? JSON.parse(row.details_json) : null;
                    const detailSelector = String(details?.selector || '').trim();
                    if (detailSelector) seenSelectors.add(detailSelector);
                } catch { }
            }

            for (const selector of secondarySelectors) {
                const currentValue = String(secondaryMap[selector] || '').trim();
                if (!currentValue || seenSelectors.has(selector)) continue;

                const allSelectors = [(product.selector_price || '').trim(), ...secondarySelectors].filter(Boolean);
                const cssIndex = allSelectors.indexOf(selector) + 1;
                const secondaryIndex = secondarySelectors.indexOf(selector) + 1;

                insertSecondaryBaseline.run(
                    product.id,
                    selector,
                    currentValue,
                    JSON.stringify({
                        role: 'secondary',
                        selector,
                        css_index: cssIndex > 0 ? cssIndex : null,
                        secondary_index: secondaryIndex > 0 ? secondaryIndex : null
                    }),
                    product.last_checked_at
                );
            }
        }

        console.log('Database initialized successfully (Local Mode).');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}
