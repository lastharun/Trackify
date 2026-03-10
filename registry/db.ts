import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.resolve(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'registry.db');
const schemaPath = path.resolve(__dirname, 'schema.sql');

export const registryDb = new Database(dbPath, {
    timeout: 5000
});

export function initRegistryDb() {
    registryDb.pragma('journal_mode = WAL');
    registryDb.pragma('foreign_keys = ON');
    registryDb.exec(fs.readFileSync(schemaPath, 'utf8'));

    const migrations = [
        `ALTER TABLE devices ADD COLUMN license_key TEXT`,
        `ALTER TABLE devices ADD COLUMN owner_label TEXT`,
        `ALTER TABLE devices ADD COLUMN device_name TEXT`,
        `ALTER TABLE devices ADD COLUMN platform TEXT`,
        `ALTER TABLE devices ADD COLUMN user_agent TEXT`,
        `ALTER TABLE devices ADD COLUMN app_version TEXT`,
        `ALTER TABLE devices ADD COLUMN last_ip TEXT`,
        `ALTER TABLE devices ADD COLUMN license_expires_at DATETIME`,
        `ALTER TABLE devices ADD COLUMN status TEXT DEFAULT 'active'`,
        `ALTER TABLE devices ADD COLUMN blocked_until DATETIME`,
        `ALTER TABLE devices ADD COLUMN reason TEXT`,
        `ALTER TABLE devices ADD COLUMN meta_json TEXT`,
        `ALTER TABLE devices ADD COLUMN last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
    ];

    for (const sql of migrations) {
        try { registryDb.prepare(sql).run(); } catch { }
    }

    const licenseMigrations = [
        `ALTER TABLE licenses ADD COLUMN owner_label TEXT`,
        `ALTER TABLE licenses ADD COLUMN status TEXT DEFAULT 'active'`,
        `ALTER TABLE licenses ADD COLUMN expires_at DATETIME`,
        `ALTER TABLE licenses ADD COLUMN bound_device_id TEXT`,
        `ALTER TABLE licenses ADD COLUMN notes TEXT`,
        `ALTER TABLE licenses ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 1`,
        `ALTER TABLE licenses ADD COLUMN last_activated_at DATETIME`,
        `ALTER TABLE licenses ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`,
        `ALTER TABLE licenses ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
    ];

    for (const sql of licenseMigrations) {
        try { registryDb.prepare(sql).run(); } catch { }
    }

    registryDb.prepare(`CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at DESC)`).run();
    registryDb.prepare(`CREATE INDEX IF NOT EXISTS idx_device_events_device_id ON device_events(device_id, created_at DESC)`).run();
    registryDb.prepare(`CREATE INDEX IF NOT EXISTS idx_devices_license_key ON devices(license_key)`).run();
    registryDb.prepare(`CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status, expires_at)`).run();
}
