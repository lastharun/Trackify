CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS device_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);
