const settingsService = require('./settingsService');
const telegram = require('../telegram/telegramClient');

function isEnabled() {
  const enabled = settingsService.get('admin_notify_enabled', 'true') === 'true';
  const chatId = settingsService.get('admin_telegram_chat_id', '');
  return enabled && !!chatId && telegram.getStatus().status === 'connected';
}

async function send(text) {
  if (!isEnabled()) return;
  const chatId = settingsService.get('admin_telegram_chat_id', '');
  try {
    await telegram.sendText(chatId, text);
  } catch (e) {
    console.error('[adminNotify] Telegram bildirimi gönderilemedi:', e.message);
  }
}

function formatDuration(startedAt, finishedAt) {
  const start = new Date(startedAt.replace(' ', 'T') + 'Z');
  const end = finishedAt ? new Date(finishedAt.replace(' ', 'T') + 'Z') : new Date();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
}

const KIND_LABELS = { slot: 'Fotoğraf Gönderimi', broadcast: 'Toplu Mesaj' };

async function notifyRunReport(run) {
  const label = KIND_LABELS[run.kind] || run.kind;
  const title = run.error_count > 0 ? '⚠️ Gönderim Tamamlandı (Hatalı)' : '✅ Gönderim Tamamlandı';
  const duration = formatDuration(run.started_at, run.finished_at);
  const lines = [
    title,
    `Tür: ${label} (${run.slot_name})`,
    `Gönderilen: ${run.sent_count}`,
    `Hata: ${run.error_count}`,
    `Süre: ${duration}`
  ];
  if (run.error_count > 0 && Array.isArray(run.details)) {
    const errorLines = run.details.filter((d) => (d.text || d).toLowerCase().includes('hata')).slice(0, 5);
    if (errorLines.length) {
      lines.push('', 'Son hatalar:');
      for (const e of errorLines) lines.push(`- ${e.text || e}`);
    }
  }
  await send(lines.join('\n'));
}

const firstErrorNotified = new Set();
async function notifyFirstError(runId, message) {
  if (firstErrorNotified.has(runId)) return;
  firstErrorNotified.add(runId);
  await send(`⚠️ Gönderimde hata başladı:\n${message}`);
}

function clearRun(runId) {
  firstErrorNotified.delete(runId);
}

module.exports = { isEnabled, send, notifyRunReport, notifyFirstError, clearRun };
