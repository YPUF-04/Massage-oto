const fs = require('fs');
const path = require('path');
const customerService = require('../services/customerService');

const state = { status: 'disabled', lastError: null, token: null, offset: 0, polling: false };

function apiUrl(method) {
  return `https://api.telegram.org/bot${state.token}/${method}`;
}

async function callApi(method, body) {
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API hatasi');
  return data.result;
}

async function callApiMultipart(method, fields, fileField, absoluteFilePath) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const buffer = fs.readFileSync(absoluteFilePath);
  const blob = new Blob([buffer]);
  form.append(fileField, blob, path.basename(absoluteFilePath));

  const res = await fetch(apiUrl(method), { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API hatasi');
  return data.result;
}

async function callApiMultipartFiles(method, fields, filesByFieldName) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  for (const [fieldName, absoluteFilePath] of Object.entries(filesByFieldName)) {
    const buffer = fs.readFileSync(absoluteFilePath);
    form.append(fieldName, new Blob([buffer]), path.basename(absoluteFilePath));
  }
  const res = await fetch(apiUrl(method), { method: 'POST', body: form });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API hatasi');
  return data.result;
}

function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1];
    if (code) {
      const customer = customerService.getByTelegramLinkCode(code);
      if (customer) {
        customerService.setTelegramChatId(code, chatId);
        callApi('sendMessage', { chat_id: chatId, text: `Merhaba ${customer.name}! Telegram hesabın başarıyla bağlandı, artık buradan paylaşım alacaksın.` }).catch(() => {});
        return;
      }
    }
    callApi('sendMessage', { chat_id: chatId, text: `Merhaba! Sohbet kimliğin: ${chatId}\nBu kodu panelden müşteri eşleştirmede veya admin bildirim ayarında kullanabilirsin.` }).catch(() => {});
    return;
  }

  if (text === '/myid') {
    callApi('sendMessage', { chat_id: chatId, text: `Sohbet kimliğin: ${chatId}` }).catch(() => {});
    return;
  }

  if (text === '/info') {
    const url = process.env.PUBLIC_BASE_URL;
    const lines = url
      ? [`Yönetim paneli: ${url}`]
      : ['Panel adresi henüz tanımlı değil.', 'Railway > Variables kısmına PUBLIC_BASE_URL ekleyip panelin adresini (örn. https://xxx.up.railway.app) gir.'];
    lines.push('', 'Diğer komutlar:', '/myid - sohbet kimliğini gösterir', '/start <kod> - müşteri hesabini bağlar');
    callApi('sendMessage', { chat_id: chatId, text: lines.join('\n') }).catch(() => {});
  }
}

async function pollLoop() {
  if (!state.polling) return;
  try {
    const updates = await callApi('getUpdates', { offset: state.offset, timeout: 25 });
    for (const u of updates) {
      state.offset = u.update_id + 1;
      handleUpdate(u);
    }
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (state.polling) setImmediate(pollLoop);
}

function start() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    state.status = 'disabled';
    state.lastError = 'TELEGRAM_BOT_TOKEN tanımlı değil';
    return null;
  }
  state.token = token;
  state.status = 'connected';
  state.lastError = null;
  state.polling = true;
  pollLoop();
  return state;
}

function getStatus() {
  return { status: state.status, lastError: state.lastError };
}

async function sendPhoto(chatId, absoluteFilePath, caption) {
  if (state.status !== 'connected') throw new Error('Telegram bot başlatılmadı');
  await callApiMultipart('sendPhoto', { chat_id: chatId, caption: caption || '' }, 'photo', absoluteFilePath);
}

// Birden fazla fotografi TEK mesaj (albüm) olarak gonderir. Telegram
// sendMediaGroup en fazla 10 foto kabul eder; daha fazlasi cagiran
// tarafindan 10'arli gruplara bolunmeli (bkz. chunkArray).
async function sendPhotoGroup(chatId, absoluteFilePaths, caption) {
  if (state.status !== 'connected') throw new Error('Telegram bot başlatılmadı');
  if (!absoluteFilePaths.length) return;
  if (absoluteFilePaths.length === 1) {
    await sendPhoto(chatId, absoluteFilePaths[0], caption);
    return;
  }
  const filesByFieldName = {};
  const media = absoluteFilePaths.map((absPath, i) => {
    const fieldName = `file${i}`;
    filesByFieldName[fieldName] = absPath;
    const item = { type: 'photo', media: `attach://${fieldName}` };
    if (i === absoluteFilePaths.length - 1 && caption) item.caption = caption;
    return item;
  });
  await callApiMultipartFiles('sendMediaGroup', { chat_id: chatId, media: JSON.stringify(media) }, filesByFieldName);
}

async function sendText(chatId, text) {
  if (state.status !== 'connected') throw new Error('Telegram bot başlatılmadı');
  await callApi('sendMessage', { chat_id: chatId, text });
}

module.exports = { start, getStatus, sendPhoto, sendPhotoGroup, sendText };
