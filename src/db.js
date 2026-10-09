const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  whatsapp_number TEXT, -- E.164 formatinda, orn 905551112233
  telegram_chat_id TEXT,
  telegram_link_code TEXT,
  platform TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp | telegram | both
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  platform TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customer_batch_progress (
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  completed_at TEXT,
  PRIMARY KEY (customer_id, batch_id)
);

CREATE TABLE IF NOT EXISTS caption_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL, -- whatsapp | telegram
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, -- morning | afternoon | evening
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  time TEXT NOT NULL, -- 'HH:MM' 24h
  customer_count INTEGER NOT NULL DEFAULT 10,
  photos_per_customer INTEGER NOT NULL DEFAULT 1,
  platforms TEXT NOT NULL DEFAULT 'whatsapp,telegram',
  use_caption INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  details TEXT
);
`);

function seedDefaults() {
  const slotCount = db.prepare('SELECT COUNT(*) AS c FROM slots').get().c;
  if (slotCount === 0) {
    const insertSlot = db.prepare(`
      INSERT INTO slots (name, label, enabled, time, customer_count, photos_per_customer, platforms, use_caption)
      VALUES (?, ?, 1, ?, ?, ?, ?, 1)
    `);
    insertSlot.run('morning', 'Sabah', '10:00', 10, 1, 'whatsapp,telegram');
    insertSlot.run('afternoon', 'Ogle', '14:00', 10, 1, 'whatsapp,telegram');
    insertSlot.run('evening', 'Aksam', '19:00', 10, 1, 'whatsapp,telegram');
  }

  const defaultSettings = {
    delay_min_sec: '20',
    delay_max_sec: '90',
    warmup_enabled: 'true',
    warmup_days: '3',
    warmup_max_per_day: '10',
    whatsapp_connected_since: '',
    admin_telegram_chat_id: '',
    daily_send_cap_whatsapp: '60',
    daily_send_cap_telegram: '0'
  };
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [k, v] of Object.entries(defaultSettings)) upsert.run(k, v);

  const capCount = db.prepare('SELECT COUNT(*) AS c FROM caption_templates').get().c;
  if (capCount === 0) {
    const insertCap = db.prepare('INSERT INTO caption_templates (platform, text, active) VALUES (?, ?, 1)');
    insertCap.run('whatsapp', 'Bugune ozel firsatlari kacirma! Detaylar icin bize yaz.');
    insertCap.run('telegram', 'Bugune ozel firsatlari kacirma! Detaylar icin bize yaz.');
  }

  const activeBatch = db.prepare("SELECT id FROM batches WHERE status = 'active' LIMIT 1").get();
  if (!activeBatch) {
    db.prepare("INSERT INTO batches (label, status) VALUES (?, 'active')").run('Ilk Arsiv');
  }
}

seedDefaults();

module.exports = db;
