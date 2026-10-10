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

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// Calisan (devam eden) run'lari ve iptal durumunu bellekte tutar. Sunucu
// yeniden baslarsa bu bilgi sifirlanir, ama zaten o anda calisan bir islem
// de kalmaz (process ile birlikte durur).
const activeRuns = new Set();
const cancelledRuns = new Set();

function registerRun(runId) {
  activeRuns.add(runId);
}
function unregisterRun(runId) {
  activeRuns.delete(runId);
  cancelledRuns.delete(runId);
}
function isCancelled(runId) {
  return cancelledRuns.has(runId);
}
function cancelRun(runId) {
  if (!activeRuns.has(runId)) return false;
  cancelledRuns.add(runId);
  return true;
}
function isRunActive(runId) {
  return activeRuns.has(runId);
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
  const min = parseFloat(settingsService.get('intra_step_delay_min_sec', '0.5')) || 0;
  const max = parseFloat(settingsService.get('intra_step_delay_max_sec', '1')) || 0;
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

// Gunluk limit artik FOTOGRAF/MESAJ SAYISI degil, FARKLI MUSTERI SAYISI
// uzerinden calisir: "bugun bu platformdan kac farkli musteriye ulasildi".
// Ayni musteriye birden fazla foto/mesaj gitmesi bu sayiyi 1 kez arttirir.
function countDistinctCustomersToday(platform) {
  const since = todayRange();
  const row = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) AS c FROM (
      SELECT customer_id FROM sent_log WHERE platform = ? AND sent_at >= ?
      UNION
      SELECT customer_id FROM message_log WHERE platform = ? AND sent_at >= ?
    )
  `).get(platform, since, platform, since);
  return row.c;
}

function wasCustomerContactedToday(customerId, platform) {
  const since = todayRange();
  const a = db.prepare('SELECT 1 FROM sent_log WHERE platform = ? AND customer_id = ? AND sent_at >= ? LIMIT 1').get(platform, customerId, since);
  if (a) return true;
  const b = db.prepare('SELECT 1 FROM message_log WHERE platform = ? AND customer_id = ? AND sent_at >= ? LIMIT 1').get(platform, customerId, since);
  return !!b;
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

// "Dalga" (wave) mantigi: once BASLANMIS ama henuz BITMEMIS musterileri
// (bu artista en az 1 foto almis ama hala eksigi olan) devam ettirir, en
// son gonderilenden en eskiye dogru siralar. Hic baslanmamis musteriler
// en sona konur. Boylece slotun "musteri sayisi" kadar musteriden olusan
// sabit bir grup, hepsi tamamlanana kadar calisilir; yeni musteriler
// ancak gruptan biri tamamlayip ayrilinca (eligible listesinden dusunce)
// devreye girer.
function orderCustomersByLeastRecentlySent(customers, batchId) {
  const withStats = customers.map((c) => {
    const row = db.prepare('SELECT MAX(sent_at) AS last_sent, COUNT(*) AS cnt FROM sent_log WHERE customer_id = ? AND batch_id = ?').get(c.id, batchId);
    return { customer: c, lastSent: row.last_sent || '', cnt: row.cnt || 0 };
  });
  withStats.sort((a, b) => {
    const aStarted = a.cnt > 0 ? 0 : 1;
    const bStarted = b.cnt > 0 ? 0 : 1;
    if (aStarted !== bStarted) return aStarted - bStarted;
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
    if (isCancelled(runId)) break;
    if (step.type === 'photos') {
      const photos = photoService.pickUnsentPhotosForCustomer(batch.id, customer.id, step.photo_count, step.category_ids);
      if (!photos.length) continue;

      const forceSingle = settingsService.get('force_single_photo_send', 'false') === 'true';

      if (platform === 'telegram') {
        // Telegram'da fotograflari 10'arli gruplar halinde TEK mesaj (albüm)
        // olarak gonderiyoruz: 20 foto icin 2 API cagrisi, hizli ve dogal.
        // "Tekli gonderim" ayari acikken gruplama kapatilir, grup boyutu 1 olur.
        const chunks = chunkArray(photos, forceSingle ? 1 : 10);
        for (let c = 0; c < chunks.length; c++) {
          if (isCancelled(runId)) break;
          const chunk = chunks[c];
          const absPaths = chunk.map((p) => photoService.absolutePath(p.filepath));
          await telegram.sendPhotoGroup(target, absPaths, null);
          for (const photo of chunk) {
            db.prepare('INSERT INTO sent_log (customer_id, photo_id, batch_id, platform) VALUES (?, ?, ?, ?)')
              .run(customer.id, photo.id, batch.id, platform);
            sentPhotos++;
          }
          pushItemEvent('🖼️', `${customer.name} (${platform}): ${chunk.length} foto grup halinde gonderildi (${sentPhotos}/${photos.length})`);
          if (c < chunks.length - 1) await sleep(randomIntraStepDelayMs());
        }
      } else {
        for (let i = 0; i < photos.length; i++) {
          if (isCancelled(runId)) break;
          const photo = photos[i];
          const absPath = photoService.absolutePath(photo.filepath);
          await whatsapp.sendImage(target, absPath, null);

          db.prepare('INSERT INTO sent_log (customer_id, photo_id, batch_id, platform) VALUES (?, ?, ?, ?)')
            .run(customer.id, photo.id, batch.id, platform);
          sentPhotos++;
          pushItemEvent('🖼️', `${customer.name} (${platform}): foto gonderildi (${i + 1}/${photos.length})`);
          // Blok icinde hizli gonderim: fotograflar arasinda sadece kisa bir bekleme var.
          if (i < photos.length - 1) await sleep(randomIntraStepDelayMs());
        }
      }
      // Blok bitti: siradaki adima/musteriye gecmeden once buyuk (anti-ban) bekleme.
      if (!isCancelled(runId)) await sleep(randomStepDelayMs());
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
    platformLoop:
    for (const platform of platforms) {
      if (isCancelled(runId)) {
        pushEvent('🛑', 'Calisma kullanici tarafindan iptal edildi.');
        break;
      }
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
      let remainingUserBudget = cap - countDistinctCustomersToday(platform);
      if (remainingUserBudget <= 0) {
        pushEvent('⏭️', `${platform}: gunluk farkli musteri limiti doldu, atlandi`);
        continue;
      }

      let eligible = customerService.activeForPlatform(platform)
        .filter((c) => !isCustomerCompleted(batch.id, c.id));
      // Foto bloklarinin tamami belirli kategorilerle sinirliysa (orn. sadece
      // Sweat), o kategorideki tum fotolari zaten almis musterileri atla;
      // sadece bu kategoriden henuz eksigi olanlara gonder.
      const stepCategoryIds = slotCategoryFilter(steps);
      if (stepCategoryIds) {
        eligible = eligible.filter((c) =>
          photoService.pickUnsentPhotosForCustomer(batch.id, c.id, 1, stepCategoryIds).length > 0);
        if (!eligible.length) {
          pushEvent('⏭️', `${platform}: secilen kategorilerde gonderilmemis fotosu kalan musteri yok`);
          continue;
        }
      }
      eligible = orderCustomersByLeastRecentlySent(eligible, batch.id);
      eligible = eligible.slice(0, slot.customer_count);

      if (!eligible.length) {
        pushEvent('⏭️', `${platform}: gonderilecek musteri yok`);
        continue;
      }

      state.totalTargets += eligible.length;
      pushEvent('📋', `${platform}: ${eligible.length} musteriye gonderim baslatiliyor`);

      for (const customer of eligible) {
        if (isCancelled(runId)) {
          pushEvent('🛑', 'Calisma kullanici tarafindan iptal edildi.');
          break platformLoop;
        }
        const isNewToday = !wasCustomerContactedToday(customer.id, platform);
        if (isNewToday && remainingUserBudget <= 0) {
          pushEvent('⏭️', `${platform}: gunluk farkli musteri limiti doldu, kalan musteriler atlandi`);
          break;
        }
        pushEvent('▶️', `${customer.name} (${platform}): adim sirasi basladi (${steps.length} adim)`);
        try {
          const result = await runStepsForCustomer(customer, platform, batch, steps, runId, pushItemEvent);
          const totalForCustomer = result.sentPhotos + result.sentMessages;
          state.totalSent += totalForCustomer;
          if (isNewToday && totalForCustomer > 0) remainingUserBudget--;
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
    unregisterRun(runId);
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
  registerRun(runId);

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
    broadcastPlatformLoop:
    for (const p of platforms) {
      if (isCancelled(runId)) {
        pushEvent('🛑', 'Calisma kullanici tarafindan iptal edildi.');
        break;
      }
      if (p === 'telegram' && telegram.getStatus().status !== 'connected') {
        pushEvent('⏭️', 'Telegram bagli degil, atlandi');
        continue;
      }
      if (p === 'whatsapp' && whatsapp.getStatus().status !== 'connected') {
        pushEvent('⏭️', 'WhatsApp bagli degil, atlandi');
        continue;
      }

      const cap = dailyCapFor(p);
      let remainingUserBudget = cap - countDistinctCustomersToday(p);
      if (remainingUserBudget <= 0) {
        pushEvent('⏭️', `${p}: gunluk farkli musteri limiti doldu, atlandi`);
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
        if (isCancelled(runId)) {
          pushEvent('🛑', 'Calisma kullanici tarafindan iptal edildi.');
          break broadcastPlatformLoop;
        }
        const isNewToday = !wasCustomerContactedToday(customer.id, p);
        if (isNewToday && remainingUserBudget <= 0) {
          pushEvent('⏭️', `${p}: gunluk farkli musteri limiti doldu, kalan musteriler atlandi`);
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
            if (isNewToday) remainingUserBudget--;
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
    unregisterRun(runId);
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
  registerRun(runId);

  const promise = executeBroadcast(runId, { platform, text: text.trim(), customerIds }).catch((e) => {
    console.error('[campaign] toplu mesaj calisirken beklenmeyen hata:', e);
  });

  return { runId, started: true, promise };
}

function getRecentRuns(limit = 20) {
  return db.prepare('SELECT * FROM run_log ORDER BY id DESC LIMIT ?').all(limit);
}

// Slottaki foto bloklarinin HEPSI kategori filtreli ise bu kategorilerin
// birlesimini doner; herhangi bir foto blogu "tum kategoriler" ise null.
function slotCategoryFilter(steps) {
  const photoSteps = steps.filter((s) => s.type === 'photos');
  if (!photoSteps.length) return null;
  const ids = new Set();
  for (const s of photoSteps) {
    if (!s.category_ids || !s.category_ids.length) return null;
    s.category_ids.forEach((id) => ids.add(id));
  }
  return [...ids];
}

// Musteri basina, aktif arsivde her kategoriden kac foto gonderildi / kac foto var.
function getCustomerCategoryStats(batchId) {
  const totals = db.prepare(`
    SELECT c.id AS category_id, c.name, COUNT(DISTINCT p.id) AS total
    FROM categories c
    JOIN photo_categories pc ON pc.category_id = c.id
    JOIN photos p ON p.id = pc.photo_id AND p.batch_id = ?
    GROUP BY c.id
  `).all(batchId);
  const sentRows = db.prepare(`
    SELECT sl.customer_id, pc.category_id, COUNT(DISTINCT sl.photo_id) AS sent
    FROM sent_log sl
    JOIN photo_categories pc ON pc.photo_id = sl.photo_id
    WHERE sl.batch_id = ?
    GROUP BY sl.customer_id, pc.category_id
  `).all(batchId);
  const byCustomer = {};
  for (const r of sentRows) {
    (byCustomer[r.customer_id] = byCustomer[r.customer_id] || {})[r.category_id] = r.sent;
  }
  return { totals, byCustomer };
}

function getBatchProgress(batchId) {
  const photos = photoService.listPhotosForBatch(batchId);
  const customers = customerService.list().filter((c) => c.active && (c.whatsapp_number || c.telegram_chat_id));
  const { totals, byCustomer } = getCustomerCategoryStats(batchId);
  const perCustomer = customers.map((c) => {
    const sentCount = db.prepare('SELECT COUNT(DISTINCT photo_id) AS c FROM sent_log WHERE batch_id = ? AND customer_id = ?').get(batchId, c.id).c;
    const sentByCat = byCustomer[c.id] || {};
    const categories = totals.map((t) => ({ name: t.name, sent: sentByCat[t.category_id] || 0, total: t.total }));
    return { customer: c, sent: sentCount, total: photos.length, completed: isCustomerCompleted(batchId, c.id), categories };
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
  countDistinctCustomersToday,
  dailyCapFor,
  cancelRun,
  isRunActive
};
