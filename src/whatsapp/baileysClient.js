const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, '..', '..', 'data', 'baileys_auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

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

async function sendImage(number, absoluteFilePath, caption) {
  if (state.status !== 'connected' || !state.sock) {
    throw new Error('WhatsApp baglantisi hazir degil');
  }
  const jid = toJid(number);
  await state.sock.sendMessage(jid, {
    image: fs.readFileSync(absoluteFilePath),
    caption: caption || undefined
  });
}

async function sendText(number, text) {
  if (state.status !== 'connected' || !state.sock) {
    throw new Error('WhatsApp baglantisi hazir degil');
  }
  const jid = toJid(number);
  await state.sock.sendMessage(jid, { text });
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
