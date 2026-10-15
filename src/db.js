const path = require('path');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./paths');

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
  kind TEXT NOT NULL DEFAULT 'slot', -- slot | broadcast
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  total_targets INTEGER NOT NULL DEFAULT 0,
  processed_targets INTEGER NOT NULL DEFAULT 0,
  details TEXT
);

CREATE TABLE IF NOT EXISTS message_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  platform TEXT NOT NULL,
  text TEXT NOT NULL,
  run_id INTEGER,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slot_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  position INTEGER NOT NULL,
  type TEXT NOT NULL, -- photos | message
  photo_count INTEGER NOT NULL DEFAULT 1,
  message_mode TEXT NOT NULL DEFAULT 'random_caption', -- random_caption | custom
  message_text TEXT,
  category_ids TEXT -- JSON dizi, bos/null = tum kategoriler
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photo_categories (
  photo_id INTEGER NOT NULL REFERENCES photos(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY (photo_id, category_id)
);
`);

// Daha once deploy edilmis veritabanlarinda eksik olabilecek kolonlari ekler.
// SQLite "ADD COLUMN IF NOT EXISTS" desteklemedigi icin hata yoksayilarak denenir.
function addColumnIfMissing(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    // kolon zaten varsa buraya duser, yoksayilir
  }
}
addColumnIfMissing('run_log', "kind TEXT NOT NULL DEFAULT 'slot'");
addColumnIfMissing('run_log', 'total_targets INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('run_log', 'processed_targets INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('slot_steps', 'category_ids TEXT');

function seedDefaults() {
  const slotCount = db.prepare('SELECT COUNT(*) AS c FROM slots').get().c;
  if (slotCount === 0) {
    const insertSlot = db.prepare(`
      INSERT INTO slots (name, label, enabled, time, customer_count, photos_per_customer, platforms, use_caption)
      VALUES (?, ?, 1, ?, ?, ?, ?, 1)
    `);
    insertSlot.run('morning', 'Sabah', '10:00', 10, 1, 'whatsapp,telegram');
    insertSlot.run('afternoon', 'Öğle', '14:00', 10, 1, 'whatsapp,telegram');
    insertSlot.run('evening', 'Akşam', '19:00', 10, 1, 'whatsapp,telegram');
  }

  const defaultSettings = {
    delay_min_sec: '5',
    delay_max_sec: '15',
    intra_step_delay_min_sec: '0.5',
    intra_step_delay_max_sec: '1',
    warmup_enabled: 'true',
    warmup_days: '3',
    warmup_max_per_day: '10',
    whatsapp_connected_since: '',
    admin_telegram_chat_id: '',
    admin_notify_enabled: 'true',
    daily_send_cap_whatsapp: '60',
    daily_send_cap_telegram: '0',
    force_single_photo_send: 'false'
  };
  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [k, v] of Object.entries(defaultSettings)) upsert.run(k, v);

  const capCount = db.prepare('SELECT COUNT(*) AS c FROM caption_templates').get().c;
  if (capCount === 0) {
    const insertCap = db.prepare('INSERT INTO caption_templates (platform, text, active) VALUES (?, ?, 1)');
    insertCap.run('whatsapp', 'Bugüne özel fırsatları kaçırma! Detaylar için bize yaz.');
    insertCap.run('telegram', 'Bugüne özel fırsatları kaçırma! Detaylar için bize yaz.');
  }

  // Eski kurulumlardaki Turkce karaktersiz etiketleri duzelt.
  db.prepare("UPDATE slots SET label = 'Öğle' WHERE label = 'Ogle'").run();
  db.prepare("UPDATE slots SET label = 'Akşam' WHERE label = 'Aksam'").run();
  db.prepare("UPDATE batches SET label = 'İlk Arşiv' WHERE label = 'Ilk Arsiv'").run();

  const activeBatch = db.prepare("SELECT id FROM batches WHERE status = 'active' LIMIT 1").get();
  if (!activeBatch) {
    db.prepare("INSERT INTO batches (label, status) VALUES (?, 'active')").run('İlk Arşiv');
  }

  // Her slotun en az bir adim sirasi (step) olmasini sagla. Eski kayitlarda
  // (photos_per_customer + use_caption) varsa bunu 2 adimlik bir sıraya tasir.
  const allSlots = db.prepare('SELECT * FROM slots').all();
  const insertStep = db.prepare(`
    INSERT INTO slot_steps (slot_id, position, type, photo_count, message_mode, message_text)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const slot of allSlots) {
    const stepCount = db.prepare('SELECT COUNT(*) AS c FROM slot_steps WHERE slot_id = ?').get(slot.id).c;
    if (stepCount > 0) continue;
    let pos = 0;
    insertStep.run(slot.id, pos++, 'photos', slot.photos_per_customer || 1, 'random_caption', null);
    if (slot.use_caption) {
      insertStep.run(slot.id, pos++, 'message', 1, 'random_caption', null);
    }
  }
}

seedDefaults();

module.exports = db;
