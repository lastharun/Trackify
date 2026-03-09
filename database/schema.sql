-- database/schema.sql

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    title TEXT,
    tracking_interval INTEGER DEFAULT 30, -- In minutes
    last_checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Phase 2 Tracking Columns
    last_extraction_status TEXT,
    last_failure_reason TEXT,
    last_extractor_used TEXT,
    last_screenshot_path TEXT,
    last_html_path TEXT,
    last_json_path TEXT,
    -- Telemetry
    last_status_code INTEGER,
    last_final_url TEXT,
    last_page_title TEXT,
    -- Scraper configuration
    selector_price TEXT,          -- Dedicated PRICE CSS selector (💰)
    selector_secondary TEXT,      -- Secondary CSS selectors (📌) — comma-separated
    selector_title TEXT,
    selector_image TEXT,
    is_active BOOLEAN DEFAULT 1,
    notification_telegram BOOLEAN DEFAULT 1,
    notification_browser BOOLEAN DEFAULT 1,
    alert_condition_type TEXT DEFAULT 'all', -- 'all', '<', '>', 'includes'
    alert_condition_value TEXT,
    last_price REAL,
    last_value TEXT,              -- Universal raw text value
    last_secondary_value TEXT,    -- Last known value of secondary selectors (for change detection)
    last_image_url TEXT,
    retry_count INTEGER DEFAULT 0,
    next_check_at DATETIME,
    wait_on_page INTEGER DEFAULT 4, -- Seconds to wait on page
    never_stop BOOLEAN DEFAULT 0, -- Don't stop on errors
    value_type TEXT DEFAULT 'price', -- 'price', 'number', 'string'
    last_viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    price REAL,
    original_price REAL,
    discounted_price REAL,
    currency TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seller_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    seller_name TEXT NOT NULL,
    price REAL,
    is_lowest BOOLEAN DEFAULT 0,
    has_buybox BOOLEAN DEFAULT 0,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    is_in_stock BOOLEAN DEFAULT 1,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    hash TEXT,
    -- Normalized data for robust diffs
    delivery_text TEXT,
    images TEXT,
    description TEXT,
    other_sellers TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS change_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    change_type TEXT NOT NULL, -- 'PRICE', 'STOCK', 'SELLER', 'CONTENT'
    field_changed TEXT,
    old_value TEXT,
    new_value TEXT,
    details_json TEXT,
    snapshot_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(snapshot_id) REFERENCES snapshots(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scrape_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    status_code INTEGER,
    failure_reason TEXT,
    final_url TEXT,
    page_title TEXT,
    screenshot_path TEXT,
    html_path TEXT,
    html_snippet TEXT,
    json_path TEXT,
    duration_ms INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    device_name TEXT,
    platform TEXT,
    user_agent TEXT,
    extension_version TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    blocked_until DATETIME,
    reason TEXT,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
