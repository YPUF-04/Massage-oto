const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { requireAuth, login, logout, sessionStatus } = require('../auth/auth');
const settingsService = require('../services/settingsService');
const customerService = require('../services/customerService');
const photoService = require('../services/photoService');
const categoryService = require('../services/categoryService');
const campaignService = require('../services/campaignService');
const whatsapp = require('../whatsapp/baileysClient');
const telegram = require('../telegram/telegramClient');
const { UPLOADS_DIR } = require('../paths');

const router = express.Router();

// --- Auth ---
router.post('/login', login);
router.post('/logout', logout);
router.get('/session', sessionStatus);

router.use(requireAuth);

// --- Dashboard / status ---
router.get('/status', (req, res) => {
  const activeBatch = photoService.getActiveBatch();
  res.json({
    whatsapp: whatsapp.getStatus(),
    telegram: telegram.getStatus(),
    warmupActive: campaignService.isWarmupActive(),
    sentToday: {
      whatsapp: campaignService.countDistinctCustomersToday('whatsapp'),
      telegram: campaignService.countDistinctCustomersToday('telegram')
    },
    dailyCap: {
      whatsapp: finiteOrNull(campaignService.dailyCapFor('whatsapp')),
      telegram: finiteOrNull(campaignService.dailyCapFor('telegram'))
    },
    activeBatch,
    batchProgress: campaignService.getBatchProgress(activeBatch.id)
  });
});

router.get('/runs', (req, res) => {
  res.json(campaignService.getRecentRuns(30).map((r) => ({ ...r, details: safeParse(r.details) })));
});

router.post('/runs/:id/cancel', (req, res) => {
  const runId = parseInt(req.params.id, 10);
  const ok = campaignService.cancelRun(runId);
  if (!ok) return res.status(400).json({ error: 'Bu calisma zaten bitmis veya bulunamadi' });
  res.json({ ok: true });
});

function finiteOrNull(n) {
  return Number.isFinite(n) ? n : null;
}

function safeParse(json) {
  try { return JSON.parse(json); } catch (e) { return json; }
}

// --- WhatsApp ---
router.post('/whatsapp/connect', async (req, res) => {
  try {
    await whatsapp.start();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/whatsapp/logout', async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/whatsapp/status', (req, res) => res.json(whatsapp.getStatus()));

// --- Telegram ---
router.get('/telegram/status', (req, res) => res.json(telegram.getStatus()));

// --- Settings & Slots ---
router.get('/settings', (req, res) => {
  res.json({ settings: settingsService.getAll(), slots: settingsService.getSlots() });
});

router.post('/settings', (req, res) => {
  const { settings } = req.body || {};
  if (settings) settingsService.setMany(settings);
  res.json({ ok: true });
});

router.put('/slots/:name', (req, res) => {
  settingsService.updateSlot(req.params.name, req.body || {});
  res.json({ ok: true, slots: settingsService.getSlots() });
});

router.post('/slots/:name/run-now', (req, res) => {
  try {
    const result = campaignService.runSlot(req.params.name, { manual: true });
    res.json({ runId: result.runId, started: !!result.started, skipped: !!result.skipped, reason: result.reason });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Adim sirasi (foto blogu / mesaj blogu, sirali) ---
router.get('/slots/:name/steps', (req, res) => {
  res.json(settingsService.getSlotSteps(req.params.name));
});

router.put('/slots/:name/steps', (req, res) => {
  try {
    const steps = settingsService.replaceSlotSteps(req.params.name, req.body.steps || []);
    res.json({ ok: true, steps });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Toplu Mesaj (fotografsiz, sadece metin) ---
router.post('/broadcast', (req, res) => {
  try {
    const { platform, text, customerIds } = req.body || {};
    const result = campaignService.runMessageBroadcast({ platform, text, customerIds });
    res.json({ runId: result.runId, started: !!result.started });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Captions ---
router.get('/captions/:platform', (req, res) => {
  res.json(settingsService.getCaptions(req.params.platform));
});

router.post('/captions/:platform', (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Metin bos olamaz' });
  settingsService.addCaption(req.params.platform, text.trim());
  res.json({ ok: true });
});

router.put('/captions/:id', (req, res) => {
  settingsService.setCaptionActive(req.params.id, !!req.body.active);
  res.json({ ok: true });
});

router.delete('/captions/:id', (req, res) => {
  settingsService.deleteCaption(req.params.id);
  res.json({ ok: true });
});

// --- Customers ---
router.get('/customers', (req, res) => res.json(customerService.list()));

router.post('/customers', (req, res) => {
  const { name, whatsapp_number, telegram_chat_id, platform } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Isim gerekli' });
  const customer = customerService.create({ name: name.trim(), whatsapp_number, telegram_chat_id, platform });
  res.json(customer);
});

router.put('/customers/:id', (req, res) => {
  const customer = customerService.update(req.params.id, req.body || {});
  res.json(customer);
});

router.delete('/customers/:id', (req, res) => {
  customerService.remove(req.params.id);
  res.json({ ok: true });
});

// --- Photos ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photoService.ACTIVE_DIR),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/photos/upload', upload.array('photos', 100), (req, res) => {
  const filenames = (req.files || []).map((f) => f.filename);
  const categories = categoryService.getOrCreateManyFromText(req.body.categories || '');
  const categoryIds = categories.map((c) => c.id);
  const batch = photoService.addPhotos(filenames, categoryIds);
  res.json({ ok: true, batch, uploaded: filenames.length, categories });
});

router.get('/photos/batches', (req, res) => res.json(photoService.listBatches()));

router.get('/photos/batches/:id/photos', (req, res) => {
  const photos = photoService.listPhotosForBatch(req.params.id);
  res.json(photos.map((p) => ({ ...p, categories: categoryService.getCategoriesForPhoto(p.id) })));
});

// --- Kategoriler ---
router.get('/categories', (req, res) => res.json(categoryService.list()));

router.post('/categories', (req, res) => {
  const { name } = req.body || {};
  const category = categoryService.getOrCreate(name);
  if (!category) return res.status(400).json({ error: 'Kategori adi bos olamaz' });
  res.json(category);
});

router.delete('/categories/:id', (req, res) => {
  categoryService.remove(req.params.id);
  res.json({ ok: true });
});

router.get('/photos/file/*', (req, res) => {
  const rel = req.params[0];
  const abs = photoService.absolutePath(rel);
  if (!abs.startsWith(UPLOADS_DIR)) return res.status(400).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  res.sendFile ? res.sendFile(abs) : fs.createReadStream(abs).pipe(res);
});

module.exports = router;
