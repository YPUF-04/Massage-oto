const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const { AUTH_DIR } = require('../paths');

const state = {
  sock: null,
  status: 'disconnected', // disconnected | connecting | qr | connected
  qrDataUrl: null,
  connectedAt: null,
  lastError: null
};

let baileys;
function loadBaileys() {
  if (!baileys) baileys = require('@whiskeysockets/baileys');
  return baileys;
}

async function start() {
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = loadBaileys();
  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  state.status = 'connecting';
  const sock = makeWASocket({
    version,
    auth: authState,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });
  state.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      state.status = 'qr';
      state.qrDataUrl = await QRCode.toDataURL(qr);
    }
    if (connection === 'open') {
      state.status = 'connected';
      state.qrDataUrl = null;
      state.connectedAt = new Date().toISOString();
      state.lastError = null;
      const settingsService = require('../services/settingsService');
      if (!settingsService.get('whatsapp_connected_since', '')) {
        settingsService.set('whatsapp_connected_since', state.connectedAt);
      }
    }
    if (connection === 'close') {
      state.status = 'disconnected';
      const code = lastDisconnect?.error?.output?.statusCode;
      state.lastError = lastDisconnect?.error?.message || null;
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => start().catch((e) => { state.lastError = e.message; }), 3000);
      }
    }
  });

  return sock;
}

function getStatus() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    connectedAt: state.connectedAt,
    lastError: state.lastError
  };
}

function toJid(number) {
  const digits = String(number).replace(/[^0-9]/g, '');
  return `${digits}@s.whatsapp.net`;
}

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Numara WhatsApp'ta kayitli mi kontrolunun sonucunu kisa sure onbellekte
// tutar. Ayni musteriye art arda 20 foto gonderirken her seferinde yeniden
// sormak (ag gidis-donusu) gereksiz yavaslatiyordu; bir kere dogrulanan
// numara bu sure icinde tekrar sorgulanmaz.
const verifiedNumberCache = new Map(); // digits -> { jid, verifiedAt }
const VERIFY_CACHE_TTL_MS = 10 * 60 * 1000;

// Numara WhatsApp'ta kayitli degilse Baileys hemen hata vermez, uzun sure
// bekleyip zaman asimina ugrar. Once hizli bir kontrol yaparak net hata veririz.
async function assertNumberOnWhatsApp(number) {
  const digits = String(number).replace(/[^0-9]/g, '');
  if (!digits) throw new Error('Geçersiz WhatsApp numarası (boş)');

  const cached = verifiedNumberCache.get(digits);
  if (cached && Date.now() - cached.verifiedAt < VERIFY_CACHE_TTL_MS) {
    return cached.jid;
  }

  const results = await withTimeout(
    state.sock.onWhatsApp(digits),
    15000,
    'WhatsApp numara kontrolü zaman aşımına uğradı (baglanti veya ağ sorunu)'
  );
  const found = Array.isArray(results) ? results[0] : null;
  if (!found || !found.exists) {
    throw new Error(`${number} numarası WhatsApp'ta kayıtlı değil`);
  }
  verifiedNumberCache.set(digits, { jid: found.jid, verifiedAt: Date.now() });
  return found.jid;
}

async function sendImage(number, absoluteFilePath, caption) {
  if (state.status !== 'connected' || !state.sock) {
    throw new Error('WhatsApp bağlantısı hazır değil');
  }
  const jid = await assertNumberOnWhatsApp(number);
  await withTimeout(
    state.sock.sendMessage(jid, {
      image: fs.readFileSync(absoluteFilePath),
      caption: caption || undefined
    }),
    30000,
    'Fotoğraf gönderimi zaman aşımına uğradı (ağ sorunu olabilir)'
  );
}

async function sendText(number, text) {
  if (state.status !== 'connected' || !state.sock) {
    throw new Error('WhatsApp bağlantısı hazır değil');
  }
  const jid = await assertNumberOnWhatsApp(number);
  await withTimeout(
    state.sock.sendMessage(jid, { text }),
    30000,
    'Mesaj gönderimi zaman aşımına uğradı (ağ sorunu olabilir)'
  );
}

async function logout() {
  if (state.sock) {
    try { await state.sock.logout(); } catch (e) { /* yoksay */ }
  }
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  state.status = 'disconnected';
  state.qrDataUrl = null;
  state.connectedAt = null;
}

module.exports = { start, getStatus, sendImage, sendText, logout };
