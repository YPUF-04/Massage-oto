const db = require('../db');

function list() {
  return db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM photo_categories pc WHERE pc.category_id = c.id) AS photo_count
    FROM categories c ORDER BY c.name ASC
  `).all();
}

function getOrCreate(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT * FROM categories WHERE name = ?').get(trimmed);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
}

// "Pantolon, Sweat, Ceket" gibi virgulle ayrilmis bir metni kategorilere cevirir (yoksa olusturur)
function getOrCreateManyFromText(text) {
  if (!text) return [];
  const names = String(text).split(',').map((n) => n.trim()).filter(Boolean);
  return names.map((n) => getOrCreate(n)).filter(Boolean);
}

function assignToPhoto(photoId, categoryIds) {
  if (!categoryIds || !categoryIds.length) return;
  const insert = db.prepare('INSERT OR IGNORE INTO photo_categories (photo_id, category_id) VALUES (?, ?)');
  const tx = db.transaction((ids) => {
    for (const id of ids) insert.run(photoId, id);
  });
  tx(categoryIds);
}

function getCategoriesForPhoto(photoId) {
  return db.prepare(`
    SELECT c.* FROM categories c
    JOIN photo_categories pc ON pc.category_id = c.id
    WHERE pc.photo_id = ?
  `).all(photoId);
}

function remove(id) {
  db.prepare('DELETE FROM photo_categories WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

module.exports = { list, getOrCreate, getOrCreateManyFromText, assignToPhoto, getCategoriesForPhoto, remove };
