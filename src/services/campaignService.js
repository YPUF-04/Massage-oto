const db = require('../db');
const settingsService = require('./settingsService');
const customerService = require('./customerService');
const photoService = require('./photoService');
const whatsapp = require('../whatsapp/baileysClient');
const telegram = require('../telegram/telegramClient');
const adminNotify = require('./adminNotify');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bloklar arasi (bir foto blogu/mesaj blogu bitince, siradaki adima veya
// siradaki musteriye gecmeden once) uygulanan buyuk, anti-ban gecikmesi.
function randomStepDelayMs() {
  const min = parseInt(settingsService.get('delay_min_sec', '20'), 10);
  const max = parseInt(settingsService.get('delay_max_sec', '90'), 10);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const seconds = lo + Math.random() * (hi - lo);
  return Math.round(seconds * 1000);
}

// Ayni foto blogu icindeki fotograflar arasi kisa gecikme. Amac anti-ban
// degil, platformun ani (burst) istek sinirina takilmamak. Hizli gonderim
// istendigi icin kucuk tutulur.
function randomIntraStepDelayMs() {
  const min = parseInt(settingsService.get('intra_step_delay_min_sec', '1'), 10);
  const max = parseInt(settingsService.get('intra_step_delay_max_sec', '3'), 10);
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
  const photoRow = db.prepare('SELECT COUNT(*) AS c FROM sent_log WHERE platform = ? AND sent_at >= ?').get(platform, since);
  const msgRow = db.prepare('SELECT COUNT(*) AS c FROM message_log WHERE platform = ? AND sent_at >= ?').get(platform, since);
  return photoRow.c + msgRow.c;
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

// Bir musteri icin tanimli adim sirasini (foto blogu -> mesaj -> foto blogu -> ...)
// sirayla isler. Her tekil gonderimden sonra pushItemEvent ile panelde goruluyor
// ve anti-ban gecikmesi uygulaniyor (cagiran taraf yapar).
async function runStepsForCustomer(customer, platform, batch, steps, runId, pushItemEvent) {
  if (isCustomerCompleted(batch.id, customer.id)) {
    return { sentPhotos: 0, sentMessages: 0, skipped: true };
  }

  const target = platform === 'whatsapp' ? customer.whatsapp_number : customer.telegram_chat_id;
  if (!target) {
    return { sentPhotos: 0, sentMessages: 0, skipped: true, noTarget: true };
  }

  let sentPhotos = 0;
  let sentMessages = 0;

  for (const step of steps) {
    if (step.type === 'photos') {
      const photos = photoService.pickUnsentPhotosForCustomer(batch.id, customer.id, step.photo_count, step.category_ids);
      if (!photos.length) continue;
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const absPath = photoService.absolutePath(photo.filepath);
        if (platform === 'whatsapp') await whatsapp.sendImage(target, absPath, null);
        else await telegram.sendPhoto(target, absPath, null);

        db.prepare('INSERT INTO sent_log (customer_id, photo_id, batch_id, platform) VALUES (?, ?, ?, ?)')
          .run(customer.id, photo.id, batch.id, platform);
        sentPhotos++;
        pushItemEvent('🖼️', `${customer.name} (${platform}): foto gonderildi (${i + 1}/${photos.length})`);
        // Blok icinde hizli gonderim: fotograflar arasinda sadece kisa bir bekleme var.
        if (i < photos.length - 1) await sleep(randomIntraStepDelayMs());
      }
      // Blok bitti: siradaki adima/musteriye gecmeden once buyuk (anti-ban) bekleme.
      await sleep(randomStepDelayMs());
    } else if (step.type === 'message') {
      const text = step.message_mode === 'custom'
        ? step.message_text
        : (settingsService.randomActiveCaption(platform) || {}).text;
      if (!text) {
        pushItemEvent('⏭️', `${customer.name} (${platform}): mesaj adimi atlandi (metin yok)`);
        continue;
      }
      if (platform === 'whatsapp') await whatsapp.sendText(target, text);
      else await telegram.sendText(target, text);

      db.prepare('INSERT INTO message_log (customer_id, platform, text, run_id) VALUES (?, ?, ?, ?)')
        .run(customer.id, platform, text, runId);
      sentMessages++;
      pushItemEvent('💬', `${customer.name} (${platform}): mesaj gonderildi - "${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`);
      await sleep(randomStepDelayMs());
    }
  }

  markCompletedIfExhausted(batch.id, customer.id);
  return { sentPhotos, sentMessages, skipped: false };
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

function nowClock() {
  return new Date().toTimeString().slice(0, 8);
}

function writeRunProgress(runId, state, finished) {
  const { totalSent, errorCount, events, totalTargets, processedTargets } = state;
  const sql = finished
    ? "UPDATE run_log SET finished_at = datetime('now'), sent_count = ?, error_count = ?, total_targets = ?, processed_targets = ?, details = ? WHERE id = ?"
    : 'UPDATE run_log SET sent_count = ?, error_count = ?, total_targets = ?, processed_targets = ?, details = ? WHERE id = ?';
  db.prepare(sql).run(totalSent, errorCount, totalTargets, processedTargets, JSON.stringify(events), runId);
}

function makeRunState() {
  return { totalSent: 0, errorCount: 0, events: [], totalTargets: 0, processedTargets: 0 };
}

function makePusher(runId, state) {
  return (icon, text) => {
    state.events.push({ t: nowClock(), icon, text });
    writeRunProgress(runId, state, false);
    if (icon === '❌') {
      adminNotify.notifyFirstError(runId, text).catch(() => {});
    }
  };
}

async function executeRun(runId, slot) {
  const state = makeRunState();
  const pushEvent = makePusher(runId, state);
  const pushItemEvent = (icon, text) => {
    state.events.push({ t: nowClock(), icon, text });
    writeRunProgress(runId, state, false);
  };

  const batch = photoService.getActiveBatch();
  const platforms = slot.platforms.split(',').map((p) => p.trim()).filter(Boolean);
  const steps = settingsService.getSlotSteps(slot.name);
  if (!steps.length) {
    pushEvent('❌', 'Bu slot icin adim sirasi tanimli degil, "Zamanlama" ayarindan en az bir adim ekle.');
    writeRunProgress(runId, state, true);
    return { sent: 0, errors: 1, details: state.events };
  }

  try {
    for (const platform of platforms) {
      if (platform === 'telegram') {
        const tgStatus = telegram.getStatus();
        if (tgStatus.status !== 'connected') {
          pushEvent('⏭️', 'Telegram bagli degil, atlandi');
          continue;
        }
      }
      if (platform === 'whatsapp') {
        const waStatus = whatsapp.getStatus();
        if (waStatus.status !== 'connected') {
          pushEvent('⏭️', 'WhatsApp bagli degil, atlandi');
          continue;
        }
      }

      const cap = dailyCapFor(platform);
      let remainingBudget = cap - countSentToday(platform);
      if (remainingBudget <= 0) {
        pushEvent('⏭️', `${platform}: gunluk limit doldu, atlandi`);
        continue;
      }

      let eligible = customerService.activeForPlatform(platform)
        .filter((c) => !isCustomerCompleted(batch.id, c.id));
      eligible = orderCustomersByLeastRecentlySent(eligible, batch.id);
      eligible = eligible.slice(0, slot.customer_count);

      if (!eligible.length) {
        pushEvent('⏭️', `${platform}: gonderilecek musteri yok`);
        continue;
      }

      state.totalTargets += eligible.length;
      pushEvent('📋', `${platform}: ${eligible.length} musteriye gonderim baslatiliyor`);

      for (const customer of eligible) {
        if (remainingBudget <= 0) {
          pushEvent('⏭️', `${platform}: gunluk limit doldu, kalan musteriler atlandi`);
          break;
        }
        pushEvent('▶️', `${customer.name} (${platform}): adim sirasi basladi (${steps.length} adim)`);
        try {
          const result = await runStepsForCustomer(customer, platform, batch, steps, runId, pushItemEvent);
          const totalForCustomer = result.sentPhotos + result.sentMessages;
          state.totalSent += totalForCustomer;
          remainingBudget -= totalForCustomer;
          if (result.noTarget) {
            pushEvent('⏭️', `${customer.name} (${platform}): ${platform === 'whatsapp' ? 'WhatsApp numarasi' : 'Telegram baglantisi'} yok, atlandi`);
          } else if (totalForCustomer > 0) {
            pushEvent('✅', `${customer.name} (${platform}): ${result.sentPhotos} foto, ${result.sentMessages} mesaj gonderildi`);
          } else if (result.skipped) {
            pushEvent('⏭️', `${customer.name} (${platform}): gonderilecek yeni foto yok, atlandi`);
          }
        } catch (e) {
          state.errorCount++;
          pushEvent('❌', `${customer.name} (${platform}) hata: ${e.message}`);
        }
        state.processedTargets++;
        writeRunProgress(runId, state, false);
      }
    }

    const archived = checkAndArchiveIfComplete(batch);
    if (archived) pushEvent('📦', 'Arsiv tamamlandi ve otomatik olarak arsivlendi.');
  } catch (e) {
    state.errorCount++;
    pushEvent('❌', `Beklenmeyen hata: ${e.message}`);
  } finally {
    writeRunProgress(runId, state, true);
  }

  const run = db.prepare('SELECT * FROM run_log WHERE id = ?').get(runId);
  adminNotify.notifyRunReport({ ...run, details: state.events }).catch(() => {});
  adminNotify.clearRun(runId);

  return { sent: state.totalSent, errors: state.errorCount, details: state.events };
}

// Slotu baslatir. HTTP istegini beklemez: calisma arka planda devam eder,
// run_log satiri her adimda guncellenir, panel bunu dakikasi dakikasina gosterir.
function runSlot(slotName, { manual = false } = {}) {
  const slot = db.prepare('SELECT * FROM slots WHERE name = ?').get(slotName);
  if (!slot) throw new Error(`Slot bulunamadi: ${slotName}`);
  if (!slot.enabled && !manual) {
    return { skipped: true, reason: 'slot devre disi' };
  }

  const runInfo = db.prepare("INSERT INTO run_log (slot_name, kind, started_at) VALUES (?, 'slot', datetime('now'))").run(slotName);
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

// --- Toplu Mesaj (fotografsiz, sadece metin) ---

async function executeBroadcast(runId, { platform, text, customerIds }) {
  const state = makeRunState();
  const pushEvent = makePusher(runId, state);

  const platforms = platform === 'both' ? ['whatsapp', 'telegram'] : [platform];

  try {
    for (const p of platforms) {
      if (p === 'telegram' && telegram.getStatus().status !== 'connected') {
        pushEvent('⏭️', 'Telegram bagli degil, atlandi');
        continue;
      }
      if (p === 'whatsapp' && whatsapp.getStatus().status !== 'connected') {
        pushEvent('⏭️', 'WhatsApp bagli degil, atlandi');
        continue;
      }

      const cap = dailyCapFor(p);
      let remainingBudget = cap - countSentToday(p);
      if (remainingBudget <= 0) {
        pushEvent('⏭️', `${p}: gunluk limit doldu, atlandi`);
        continue;
      }

      let targets = customerService.activeForPlatform(p);
      if (customerIds && customerIds.length) {
        const idSet = new Set(customerIds.map(Number));
        targets = targets.filter((c) => idSet.has(c.id));
      }

      if (!targets.length) {
        pushEvent('⏭️', `${p}: gonderilecek musteri yok`);
        continue;
      }

      state.totalTargets += targets.length;
      pushEvent('📋', `${p}: ${targets.length} musteriye mesaj gonderimi baslatiliyor`);

      for (const customer of targets) {
        if (remainingBudget <= 0) {
          pushEvent('⏭️', `${p}: gunluk limit doldu, kalan musteriler atlandi`);
          break;
        }
        pushEvent('📤', `${customer.name} (${p}): mesaj gonderiliyor...`);
        try {
          const target = p === 'whatsapp' ? customer.whatsapp_number : customer.telegram_chat_id;
          if (!target) {
            pushEvent('⏭️', `${customer.name} (${p}): ${p === 'whatsapp' ? 'WhatsApp numarasi' : 'Telegram baglantisi'} yok, atlandi`);
          } else {
            if (p === 'whatsapp') await whatsapp.sendText(target, text);
            else await telegram.sendText(target, text);
            db.prepare('INSERT INTO message_log (customer_id, platform, text, run_id) VALUES (?, ?, ?, ?)')
              .run(customer.id, p, text, runId);
            state.totalSent++;
            remainingBudget--;
            pushEvent('✅', `${customer.name} (${p}): mesaj gonderildi`);
          }
        } catch (e) {
          state.errorCount++;
          pushEvent('❌', `${customer.name} (${p}) hata: ${e.message}`);
        }
        state.processedTargets++;
        writeRunProgress(runId, state, false);
        await sleep(randomStepDelayMs());
      }
    }
  } catch (e) {
    state.errorCount++;
    pushEvent('❌', `Beklenmeyen hata: ${e.message}`);
  } finally {
    writeRunProgress(runId, state, true);
  }

  const run = db.prepare('SELECT * FROM run_log WHERE id = ?').get(runId);
  adminNotify.notifyRunReport({ ...run, details: state.events }).catch(() => {});
  adminNotify.clearRun(runId);

  return { sent: state.totalSent, errors: state.errorCount, details: state.events };
}

function runMessageBroadcast({ platform, text, customerIds }) {
  if (!text || !text.trim()) throw new Error('Mesaj metni bos olamaz');
  if (!['whatsapp', 'telegram', 'both'].includes(platform)) throw new Error('Gecersiz platform');

  const runInfo = db.prepare("INSERT INTO run_log (slot_name, kind, started_at) VALUES (?, 'broadcast', datetime('now'))").run('broadcast');
  const runId = runInfo.lastInsertRowid;

  const promise = executeBroadcast(runId, { platform, text: text.trim(), customerIds }).catch((e) => {
    console.error('[campaign] toplu mesaj calisirken beklenmeyen hata:', e);
  });

  return { runId, started: true, promise };
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
  runMessageBroadcast,
  getRecentRuns,
  getBatchProgress,
  isWarmupActive,
  countSentToday,
  dailyCapFor
};
