const path = require('path');
const fs = require('fs');

// Tek bir kalici depo klasoru. Railway'de sadece bu klasoru
// (varsayilan: /app/storage) bir Volume'a baglamak yeterli.
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage');
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const ACTIVE_DIR = path.join(UPLOADS_DIR, 'active');
const ARCHIVE_DIR = path.join(UPLOADS_DIR, 'archive');
const AUTH_DIR = path.join(DATA_DIR, 'baileys_auth');

for (const dir of [DATA_DIR, ACTIVE_DIR, ARCHIVE_DIR, AUTH_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { STORAGE_DIR, DATA_DIR, UPLOADS_DIR, ACTIVE_DIR, ARCHIVE_DIR, AUTH_DIR };
