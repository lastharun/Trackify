CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
    license_key TEXT,
    owner_label TEXT,
    device_name TEXT,
    platform TEXT,
    user_agent TEXT,
    app_version TEXT,
    last_ip TEXT,
    license_expires_at DATETIME,
    status TEXT NOT NULL DEFAULT 'active',
    blocked_until DATETIME,
    reason TEXT,
    meta_json TEXT,
    last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key TEXT NOT NULL UNIQUE,
    owner_label TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at DATETIME,
    bound_device_id TEXT,
    notes TEXT,
    max_devices INTEGER NOT NULL DEFAULT 1,
    last_activated_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(bound_device_id) REFERENCES devices(device_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
