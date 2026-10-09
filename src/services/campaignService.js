const db = require('../db');
const settingsService = require('./settingsService');
const customerService = require('./customerService');
const photoService = require('./photoService');
const whatsapp = require('../whatsapp/baileysClient');
const telegram = require('../telegram/telegramClient');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs() {
  const min = parseInt(settingsService.get('delay_min_sec', '20'), 10);
  const max = parseInt(settingsService.get('delay_max_sec', '90'), 10);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const seconds = lo + Math.random() * (hi - lo);
  return Math.round(seconds * 1000);
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString().slice(0, 19).replace('T', ' ');
}

function countSentToday(platform) {
  const since = todayRange();
  const row = db.prepare('SELECT COUNT(*) AS c FROM sent_log WHERE platform = ? AND sent_at >= ?').get(platform, since);
  return row.c;
}

function isWarmupActive() {
  const enabled = settingsService.get('warmup_enabled', 'true') === 'true';
  if (!enabled) return false;
  const since = settingsService.get('whatsapp_connected_since', '');
  if (!since) return false;
  const days = parseInt(settingsService.get('warmup_days', '3'), 10);
  const connectedAt = new Date(since);
  const diffDays = (Date.now() - connectedAt.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays < days;
}

function dailyCapFor(platform) {
  if (platform === 'whatsapp' && isWarmupActive()) {
    return parseInt(settingsService.get('warmup_max_per_day', '10'), 10);
  }
  const key = platform === 'whatsapp' ? 'daily_send_cap_whatsapp' : 'daily_send_cap_telegram';
  const val = parseInt(settingsService.get(key, '0'), 10);
  return val > 0 ? val : Infinity;
}

function hasUnsentPhotos(batchId, customerId) {
  return photoService.pickUnsentPhotosForCustomer(batchId, customerId, 1).length > 0;
}

function markCompletedIfExhausted(batchId, customerId) {
  if (!hasUnsentPhotos(batchId, customerId)) {
    db.prepare(`
      INSERT INTO customer_batch_progress (customer_id, batch_id, completed_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(customer_id, batch_id) DO UPDATE SET completed_at = excluded.completed_at
    `).run(customerId, batchId);
    return true;
  }
  return false;
}

function isCustomerCompleted(batchId, customerId) {
  const row = db.prepare('SELECT completed_at FROM customer_batch_progress WHERE customer_id = ? AND batch_id = ?').get(customerId, batchId);
  return !!(row && row.completed_at);
}

function orderCustomersByLeastRecentlySent(customers, batchId) {
  const withStats = customers.map((c) => {
    const row = db.prepare('SELECT MAX(sent_at) AS last_sent, COUNT(*) AS cnt FROM sent_log WHERE customer_id = ? AND batch_id = ?').get(c.id, batchId);
    return { customer: c, lastSent: row.last_sent || '', cnt: row.cnt || 0 };
  });
  withStats.sort((a, b) => {
    if (a.cnt !== b.cnt) return a.cnt - b.cnt;
    return a.lastSent < b.lastSent ? -1 : a.lastSent > b.lastSent ? 1 : 0;
  });
  return withStats.map((w) => w.customer);
}

async function sendToCustomerOnPlatform(customer, platform, batch, photosPerCustomer, useCaption) {
  if (isCustomerCompleted(batch.id, customer.id)) return { sent: 0, skipped: true };

  const photos = photoService.pickUnsentPhotosForCustomer(batch.id, customer.id, photosPerCustomer);
  if (!photos.length) {
    markCompletedIfExhausted(batch.id, customer.id);
    return { sent: 0, skipped: true };
  }

  const caption = useCaption ? settingsService.randomActiveCaption(platform) : null;
  let sentCount = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const absPath = photoService.absolutePath(photo.filepath);
    const captionText = i === photos.length - 1 ? (caption ? caption.text : null) : null;

    if (platform === 'whatsapp') {
      if (!customer.whatsapp_number) break;
      await whatsapp.sendImage(customer.whatsapp_number, absPath, captionText);
    } else if (platform === 'telegram') {
      if (!customer.telegram_chat_id) break;
      await telegram.sendPhoto(customer.telegram_chat_id, absPath, captionText);
    }

    db.prepare('INSERT INTO sent_log (customer_id, photo_id, batch_id, platform) VALUES (?, ?, ?, ?)')
      .run(customer.id, photo.id, batch.id, platform);
    sentCount++;

    if (i < photos.length - 1) await sleep(randomDelayMs());
  }

  markCompletedIfExhausted(batch.id, customer.id);
  return { sent: sentCount, skipped: false };
}

function checkAndArchiveIfComplete(batch) {
  const allPhotos = photoService.listPhotosForBatch(batch.id);
  if (!allPhotos.length) return false;

  const allCustomers = customerService.list().filter((c) => c.active);
  const targeted = allCustomers.filter((c) => c.whatsapp_number || c.telegram_chat_id);
  if (!targeted.length) return false;

  const allDone = targeted.every((c) => !hasUnsentPhotos(batch.id, c.id));
  if (allDone) {
    photoService.archiveBatch(batch.id);
    photoService.getActiveBatch(); // yeni aktif arsivi olustur
    return true;
  }
  return false;
}

function writeRunProgress(runId, totalSent, errorCount, details, finished) {
  if (finished) {
    db.prepare('UPDATE run_log SET finished_at = datetime(\'now\'), sent_count = ?, error_count = ?, details = ? WHERE id = ?')
      .run(totalSent, errorCount, JSON.stringify(details), runId);
  } else {
    db.prepare('UPDATE run_log SET sent_count = ?, error_count = ?, details = ? WHERE id = ?')
      .run(totalSent, errorCount, JSON.stringify(details), runId);
  }
}

async function executeRun(runId, slot) {
  let totalSent = 0;
  let errorCount = 0;
  const details = [];
  const pushDetail = (line) => {
    details.push(line);
    writeRunProgress(runId, totalSent, errorCount, details, false);
  };

  const batch = photoService.getActiveBatch();
  const platforms = slot.platforms.split(',').map((p) => p.trim()).filter(Boolean);

  try {
    for (const platform of platforms) {
      if (platform === 'telegram') {
        const tgStatus = telegram.getStatus();
        if (tgStatus.status !== 'connected') {
          pushDetail('Telegram bagli degil, atlandi');
          continue;
        }
      }
      if (platform === 'whatsapp') {
        const waStatus = whatsapp.getStatus();
        if (waStatus.status !== 'connected') {
          pushDetail('WhatsApp bagli degil, atlandi');
          continue;
        }
      }

      const cap = dailyCapFor(platform);
      let remainingBudget = cap - countSentToday(platform);
      if (remainingBudget <= 0) {
        pushDetail(`${platform}: gunluk limit doldu, atlandi`);
        continue;
      }

      let eligible = customerService.activeForPlatform(platform)
        .filter((c) => !isCustomerCompleted(batch.id, c.id));
      eligible = orderCustomersByLeastRecentlySent(eligible, batch.id);
      eligible = eligible.slice(0, slot.customer_count);

      if (!eligible.length) {
        pushDetail(`${platform}: gonderilecek musteri yok`);
        continue;
      }

      for (const customer of eligible) {
        if (remainingBudget <= 0) {
          pushDetail(`${platform}: gunluk limit doldu, kalan musteriler atlandi`);
          break;
        }
        pushDetail(`${customer.name} (${platform}): gonderiliyor...`);
        try {
          const result = await sendToCustomerOnPlatform(customer, platform, batch, slot.photos_per_customer, !!slot.use_caption);
          totalSent += result.sent;
          remainingBudget -= result.sent;
          if (result.sent > 0) {
            pushDetail(`${customer.name} (${platform}): ${result.sent} foto gonderildi`);
            await sleep(randomDelayMs());
          } else if (result.skipped) {
            pushDetail(`${customer.name} (${platform}): gonderilecek yeni foto yok, atlandi`);
          }
        } catch (e) {
          errorCount++;
          pushDetail(`${customer.name} (${platform}) hata: ${e.message}`);
        }
      }
    }

    const archived = checkAndArchiveIfComplete(batch);
    if (archived) pushDetail('Arsiv tamamlandi ve otomatik olarak arsivlendi.');
  } catch (e) {
    errorCount++;
    pushDetail(`Beklenmeyen hata: ${e.message}`);
  } finally {
    writeRunProgress(runId, totalSent, errorCount, details, true);
  }

  return { sent: totalSent, errors: errorCount, details };
}

// Slotu baslatir. HTTP istegini beklemez: calisma arka planda devam eder,
// run_log satiri her adimda guncellenir, panel bunu dakikasi dakikasina gosterir.
function runSlot(slotName, { manual = false } = {}) {
  const slot = db.prepare('SELECT * FROM slots WHERE name = ?').get(slotName);
  if (!slot) throw new Error(`Slot bulunamadi: ${slotName}`);
  if (!slot.enabled && !manual) {
    return { skipped: true, reason: 'slot devre disi' };
  }

  const runInfo = db.prepare('INSERT INTO run_log (slot_name, started_at) VALUES (?, datetime(\'now\'))').run(slotName);
  const runId = runInfo.lastInsertRowid;

  const promise = executeRun(runId, slot).catch((e) => {
    console.error(`[campaign] ${slotName} calisirken beklenmeyen hata:`, e);
  });

  return { runId, started: true, promise };
}

// Zamanlayici (cron) icin: calisma tamamen bitene kadar bekler.
async function runSlotAndWait(slotName, opts) {
  const result = runSlot(slotName, opts);
  if (result.skipped) return result;
  return result.promise;
}

function getRecentRuns(limit = 20) {
  return db.prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT ?').all(limit);
}

function getBatchProgress(batchId) {
  const photos = photoService.listPhotosForBatch(batchId);
  const customers = customerService.list().filter((c) => c.active && (c.whatsapp_number || c.telegram_chat_id));
  const perCustomer = customers.map((c) => {
    const sentCount = db.prepare('SELECT COUNT(DISTINCT photo_id) AS c FROM sent_log WHERE batch_id = ? AND customer_id = ?').get(batchId, c.id).c;
    return { customer: c, sent: sentCount, total: photos.length, completed: isCustomerCompleted(batchId, c.id) };
  });
  return { totalPhotos: photos.length, customers: perCustomer };
}

module.exports = {
  runSlot,
  runSlotAndWait,
  getRecentRuns,
  getBatchProgress,
  isWarmupActive,
  countSentToday,
  dailyCapFor
};
