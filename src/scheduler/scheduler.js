const cron = require('node-cron');
const db = require('../db');
const campaignService = require('../services/campaignService');

let lastTriggeredMinute = null;

function currentHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function start() {
  // Her dakika kontrol eder, panelden degistirilen saatler aninda etkili olur
  cron.schedule('* * * * *', async () => {
    const nowHHMM = currentHHMM();
    if (nowHHMM === lastTriggeredMinute) return;
    if (!campaignService.isAutomationEnabled()) return;

    const slots = db.prepare('SELECT * FROM slots WHERE enabled = 1 AND time = ?').all(nowHHMM);
    if (!slots.length) return;

    lastTriggeredMinute = nowHHMM;
    for (const slot of slots) {
      try {
        console.log(`[scheduler] ${slot.name} slotu tetiklendi (${nowHHMM})`);
        await campaignService.runSlotAndWait(slot.name);
      } catch (e) {
        console.error(`[scheduler] ${slot.name} slotu hata verdi:`, e.message);
      }
    }
  });

  console.log('[scheduler] basladi, her dakika slot kontrolu yapilacak');
}

module.exports = { start };
