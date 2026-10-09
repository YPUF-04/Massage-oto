const fs = require('fs');
const path = require('path');

// Basit .env yukleyici (ekstra bagimlilik eklememek icin elle yazildi)
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const express = require('express');
const cookieSession = require('cookie-session');

const apiRouter = require('./routes/api');
const whatsapp = require('./whatsapp/baileysClient');
const telegram = require('./telegram/telegramClient');
const scheduler = require('./scheduler/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(cookieSession({
  name: 'massage_oto_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-degistir',
  maxAge: 30 * 24 * 60 * 60 * 1000
}));

app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT} uzerinde calisiyor`);
});

// Telegram botu hemen baslat (token varsa)
try {
  telegram.start();
} catch (e) {
  console.error('[telegram] baslatilamadi:', e.message);
}

// WhatsApp onceki oturum varsa otomatik baglanmayi dene
whatsapp.start().catch((e) => console.error('[whatsapp] baslatilamadi:', e.message));

scheduler.start();

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
