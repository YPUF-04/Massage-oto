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

function getSlotByName(name) {
  return db.prepare('SELECT * FROM slots WHERE name = ?').get(name);
}

function getSlotSteps(slotName) {
  const slot = getSlotByName(slotName);
  if (!slot) return [];
  return db.prepare('SELECT * FROM slot_steps WHERE slot_id = ? ORDER BY position ASC').all(slot.id);
}

// steps: [{ type: 'photos'|'message', photo_count, message_mode: 'random_caption'|'custom', message_text }]
function replaceSlotSteps(slotName, steps) {
  const slot = getSlotByName(slotName);
  if (!slot) throw new Error(`Slot bulunamadi: ${slotName}`);
  if (!Array.isArray(steps) || !steps.length) throw new Error('En az bir adim gerekli');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM slot_steps WHERE slot_id = ?').run(slot.id);
    const insert = db.prepare(`
      INSERT INTO slot_steps (slot_id, position, type, photo_count, message_mode, message_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    steps.forEach((step, idx) => {
      const type = step.type === 'message' ? 'message' : 'photos';
      const photoCount = Math.max(1, parseInt(step.photo_count, 10) || 1);
      const messageMode = step.message_mode === 'custom' ? 'custom' : 'random_caption';
      const messageText = messageMode === 'custom' ? String(step.message_text || '').trim() : null;
      if (type === 'message' && messageMode === 'custom' && !messageText) {
        throw new Error(`${idx + 1}. adim: ozel mesaj metni bos olamaz`);
      }
      insert.run(slot.id, idx, type, photoCount, messageMode, messageText);
    });
  });
  tx();
  return getSlotSteps(slotName);
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
  getSlotSteps, replaceSlotSteps,
  getCaptions, addCaption, setCaptionActive, deleteCaption, randomActiveCaption
};
