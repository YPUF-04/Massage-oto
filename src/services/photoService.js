const path = require('path');
const fs = require('fs');
const db = require('../db');
const { UPLOADS_DIR, ACTIVE_DIR, ARCHIVE_DIR } = require('../paths');

function getActiveBatch() {
  let batch = db.prepare("SELECT * FROM batches WHERE status = 'active' LIMIT 1").get();
  if (!batch) {
    const info = db.prepare("INSERT INTO batches (label, status) VALUES (?, 'active')").run('Yeni Arsiv');
    batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(info.lastInsertRowid);
  }
  return batch;
}

function addPhotos(filenames, categoryIds) {
  const batch = getActiveBatch();
  const insert = db.prepare('INSERT INTO photos (batch_id, filename, filepath) VALUES (?, ?, ?)');
  const insertCategory = db.prepare('INSERT OR IGNORE INTO photo_categories (photo_id, category_id) VALUES (?, ?)');
  const tx = db.transaction((files) => {
    for (const f of files) {
      const info = insert.run(batch.id, f, path.join('active', f));
      if (categoryIds && categoryIds.length) {
        for (const catId of categoryIds) insertCategory.run(info.lastInsertRowid, catId);
      }
    }
  });
  tx(filenames);
  return batch;
}

function listBatches() {
  const batches = db.prepare('SELECT * FROM batches ORDER BY created_at DESC').all();
  return batches.map((b) => ({
    ...b,
    photo_count: db.prepare('SELECT COUNT(*) AS c FROM photos WHERE batch_id = ?').get(b.id).c
  }));
}

// categoryIds verilirse, sadece o kategorilerden en az birine ait fotograflar donulur.
// Bos/null ise tum fotograflar (kategori farketmeksizin) donulur.
function listPhotosForBatch(batchId, categoryIds) {
  if (categoryIds && categoryIds.length) {
    const placeholders = categoryIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT DISTINCT p.* FROM photos p
      JOIN photo_categories pc ON pc.photo_id = p.id
      WHERE p.batch_id = ? AND pc.category_id IN (${placeholders})
    `).all(batchId, ...categoryIds);
  }
  return db.prepare('SELECT * FROM photos WHERE batch_id = ?').all(batchId);
}

// Fotograflari bu musteriye daha once gonderilmemis olanlardan rastgele sec.
// categoryIds verilirse secim o kategorilerle sinirlanir (orn. sadece "Pantolon" ve "Sweat").
function pickUnsentPhotosForCustomer(batchId, customerId, count, categoryIds) {
  const sentIds = db.prepare('SELECT photo_id FROM sent_log WHERE batch_id = ? AND customer_id = ?')
    .all(batchId, customerId).map((r) => r.photo_id);
  const all = listPhotosForBatch(batchId, categoryIds);
  const unsent = sentIds.length ? all.filter((p) => !sentIds.includes(p.id)) : all;
  // Fisher-Yates kismi karistirma
  const pool = [...unsent];
  for (let i = pool.length - 1; i > 0 && i >= pool.length - count; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(Math.max(0, pool.length - count));
}

function absolutePath(relativeFilepath) {
  return path.join(UPLOADS_DIR, relativeFilepath);
}

function archiveBatch(batchId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch || batch.status === 'archived') return batch;

  const photos = listPhotosForBatch(batchId);
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const targetDir = path.join(ARCHIVE_DIR, `batch-${batchId}`);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  for (const photo of photos) {
    const src = absolutePath(photo.filepath);
    const dest = path.join(targetDir, photo.filename);
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dest);
    } catch (e) {
      // dosya zaten yoksa yoksay
    }
    const newRel = path.join('archive', `batch-${batchId}`, photo.filename);
    db.prepare('UPDATE photos SET filepath = ? WHERE id = ?').run(newRel, photo.id);
  }

  db.prepare("UPDATE batches SET status = 'archived', archived_at = datetime('now') WHERE id = ?").run(batchId);
  return db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
}

module.exports = {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  getActiveBatch,
  addPhotos,
  listBatches,
  listPhotosForBatch,
  pickUnsentPhotosForCustomer,
  absolutePath,
  archiveBatch
};
