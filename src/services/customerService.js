const crypto = require('crypto');
const db = require('../db');

function list() {
  return db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
}

function get(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function getByTelegramLinkCode(code) {
  return db.prepare('SELECT * FROM customers WHERE telegram_link_code = ?').get(code);
}

function create({ name, whatsapp_number, telegram_chat_id, platform }) {
  const telegram_link_code = crypto.randomBytes(4).toString('hex');
  const info = db.prepare(`
    INSERT INTO customers (name, whatsapp_number, telegram_chat_id, telegram_link_code, platform, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(name, whatsapp_number || null, telegram_chat_id || null, telegram_link_code, platform || 'whatsapp');
  return get(info.lastInsertRowid);
}

function update(id, fields) {
  const allowed = ['name', 'whatsapp_number', 'telegram_chat_id', 'platform', 'active'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return get(id);
  params.push(id);
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return get(id);
}

// Musteriye bagli tum kayitlari (foto, mesaj, ilerleme) birlikte siler.
// Biri eksik kalirsa foreign key hatasi verir ve musteri silinmez.
const removeTx = db.transaction((id) => {
  db.prepare('DELETE FROM customer_batch_progress WHERE customer_id = ?').run(id);
  db.prepare('DELETE FROM sent_log WHERE customer_id = ?').run(id);
  db.prepare('DELETE FROM message_log WHERE customer_id = ?').run(id);
  db.prepare('DELETE FROM customers WHERE id = ?').run(id);
});

function remove(id) {
  removeTx(id);
}

function setTelegramChatId(linkCode, chatId) {
  db.prepare('UPDATE customers SET telegram_chat_id = ? WHERE telegram_link_code = ?').run(String(chatId), linkCode);
}

function activeForPlatform(platform) {
  // platform: 'whatsapp' or 'telegram'
  return db.prepare(`
    SELECT * FROM customers
    WHERE active = 1 AND (platform = ? OR platform = 'both')
  `).all(platform);
}

module.exports = { list, get, getByTelegramLinkCode, create, update, remove, setTelegramChatId, activeForPlatform };
