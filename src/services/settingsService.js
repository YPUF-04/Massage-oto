const db = require('../db');

function getAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

function get(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function set(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function setMany(obj) {
  const stmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(Object.entries(obj));
}

function getSlots() {
  return db.prepare('SELECT * FROM slots ORDER BY time ASC').all();
}

function updateSlot(name, fields) {
  const allowed = ['enabled', 'time', 'customer_count', 'photos_per_customer', 'platforms', 'use_caption', 'label'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return;
  params.push(name);
  db.prepare(`UPDATE slots SET ${sets.join(', ')} WHERE name = ?`).run(...params);
}

function getCaptions(platform) {
  return db.prepare('SELECT * FROM caption_templates WHERE platform = ? ORDER BY id DESC').all(platform);
}

function addCaption(platform, text) {
  return db.prepare('INSERT INTO caption_templates (platform, text, active) VALUES (?, ?, 1)').run(platform, text);
}

function setCaptionActive(id, active) {
  db.prepare('UPDATE caption_templates SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function deleteCaption(id) {
  db.prepare('DELETE FROM caption_templates WHERE id = ?').run(id);
}

function randomActiveCaption(platform) {
  const rows = db.prepare('SELECT * FROM caption_templates WHERE platform = ? AND active = 1').all(platform);
  if (!rows.length) return null;
  return rows[Math.floor(Math.random() * rows.length)];
}

module.exports = {
  getAll, get, set, setMany,
  getSlots, updateSlot,
  getCaptions, addCaption, setCaptionActive, deleteCaption, randomActiveCaption
};
