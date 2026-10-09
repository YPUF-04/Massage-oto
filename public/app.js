const api = {
  async call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Giris gerekli');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Hata olustu');
    return data;
  },
  get(url) { return this.call('GET', url); },
  post(url, body) { return this.call('POST', url, body); },
  put(url, body) { return this.call('PUT', url, body); },
  del(url) { return this.call('DELETE', url); }
};

function showLogin() {
  document.getElementById('login-screen').style.display = '';
  document.getElementById('app-screen').style.display = 'none';
}
function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = '';
  initApp();
}

async function checkSession() {
  try {
    const { authed } = await fetch('/api/session').then((r) => r.json());
    if (authed) showApp(); else showLogin();
  } catch (e) {
    showLogin();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  try {
    await api.post('/api/login', { username, password });
    showApp();
  } catch (err) {
    errBox.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api.post('/api/logout');
  showLogin();
});

let appInitialized = false;
function initApp() {
  if (appInitialized) { refreshCurrentTab(); return; }
  appInitialized = true;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('wa-connect-btn').addEventListener('click', async () => {
    await api.post('/api/whatsapp/connect');
    pollWhatsapp();
  });
  document.getElementById('wa-logout-btn').addEventListener('click', async () => {
    await api.post('/api/whatsapp/logout');
    loadDashboard();
  });

  document.getElementById('photo-upload-btn').addEventListener('click', uploadPhotos);

  document.getElementById('cust-add-btn').addEventListener('click', addCustomer);

  document.getElementById('cap-wa-add').addEventListener('click', () => addCaption('whatsapp'));
  document.getElementById('cap-tg-add').addEventListener('click', () => addCaption('telegram'));

  document.getElementById('settings-save-btn').addEventListener('click', saveSettings);

  switchTab('dashboard');
  setInterval(() => { if (currentTab === 'dashboard') loadDashboard(); }, 3000);
}

let currentTab = 'dashboard';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.style.display = p.id === `tab-${tab}` ? '' : 'none'; });
  refreshCurrentTab();
}

function refreshCurrentTab() {
  if (currentTab === 'dashboard') loadDashboard();
  if (currentTab === 'photos') loadPhotos();
  if (currentTab === 'customers') loadCustomers();
  if (currentTab === 'schedule') loadSchedule();
  if (currentTab === 'captions') loadCaptions();
  if (currentTab === 'settings') loadSettings();
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const s = await api.get('/api/status');

  const waBox = document.getElementById('wa-status');
  const waPill = s.whatsapp.status === 'connected' ? 'ok' : s.whatsapp.status === 'qr' ? 'warn' : 'bad';
  waBox.innerHTML = `<span class="pill ${waPill}">${s.whatsapp.status}</span> ${s.whatsapp.lastError ? '<span class="muted small">' + s.whatsapp.lastError + '</span>' : ''}`;
  const qrWrap = document.getElementById('wa-qr-wrap');
  qrWrap.innerHTML = s.whatsapp.qrDataUrl ? `<img src="${s.whatsapp.qrDataUrl}" alt="QR" /><p class="muted small">Telefonunda WhatsApp > Baglı Cihazlar > Cihaz Baglama ile bu kodu okut.</p>` : '';

  const tgBox = document.getElementById('tg-status');
  const tgPill = s.telegram.status === 'connected' ? 'ok' : 'bad';
  tgBox.innerHTML = `<span class="pill ${tgPill}">${s.telegram.status}</span> ${s.telegram.lastError ? '<span class="muted small">' + s.telegram.lastError + '</span>' : ''}`;

  const todayBox = document.getElementById('today-stats');
  todayBox.innerHTML = `
    WhatsApp: <b>${s.sentToday.whatsapp}</b> / ${s.dailyCap.whatsapp === null ? '∞' : s.dailyCap.whatsapp}
    ${s.warmupActive ? '<span class="pill warn">Isinma modu aktif</span>' : ''}<br/>
    Telegram: <b>${s.sentToday.telegram}</b> / ${s.dailyCap.telegram === null ? '∞' : s.dailyCap.telegram}
  `;

  const progressBox = document.getElementById('batch-progress');
  const bp = s.batchProgress;
  progressBox.innerHTML = `
    <p class="muted small">Arsiv: ${s.activeBatch.label} - toplam ${bp.totalPhotos} fotograf</p>
    <table class="table">
      <thead><tr><th>Musteri</th><th>Gonderildi</th><th>Tamamlandi</th></tr></thead>
      <tbody>
        ${bp.customers.map((c) => `<tr><td>${c.customer.name}</td><td>${c.sent}/${c.total}</td><td>${c.completed ? 'Evet' : 'Hayir'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Musteri yok</td></tr>'}
      </tbody>
    </table>
  `;

  const runNowRow = document.getElementById('run-now-row');
  if (!runNowRow.dataset.loaded) {
    const { slots } = await api.get('/api/settings');
    runNowRow.innerHTML = slots.map((sl) => `<button data-slot="${sl.name}" class="run-now-btn">${sl.label} simdi calistir</button>`).join('');
    runNowRow.querySelectorAll('.run-now-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const original = btn.textContent;
        btn.disabled = true;
        try {
          const r = await api.post(`/api/slots/${btn.dataset.slot}/run-now`);
          if (r.skipped) {
            alert('Baslamadi: ' + (r.reason || 'bilinmeyen sebep'));
          }
        } catch (e) {
          alert('Hata: ' + e.message);
        }
        btn.disabled = false;
        btn.textContent = original;
        loadDashboard();
      });
    });
    runNowRow.dataset.loaded = '1';
  }

  const runs = await api.get('/api/runs');
  document.getElementById('run-log').innerHTML = `
    <table class="table">
      <thead><tr><th>Slot</th><th>Durum</th><th>Basladi</th><th>Gonderim</th><th>Hata</th><th>Detay</th></tr></thead>
      <tbody>
        ${runs.map((r) => `<tr><td>${r.slot_name}</td><td>${r.finished_at ? '<span class="pill ok">bitti</span>' : '<span class="pill warn">devam ediyor</span>'}</td><td>${r.started_at}</td><td>${r.sent_count}</td><td>${r.error_count}</td><td class="small">${formatRunDetails(r.details)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Henuz calisma yok</td></tr>'}
      </tbody>
    </table>
  `;
}

function formatRunDetails(details) {
  if (!details) return '';
  const list = Array.isArray(details) ? details : [details];
  if (!list.length) return '';
  return list.map((line) => escapeHtml(String(line))).join('<br/>');
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let waPolling = null;
function pollWhatsapp() {
  if (waPolling) clearInterval(waPolling);
  waPolling = setInterval(async () => {
    const s = await api.get('/api/whatsapp/status');
    if (s.status === 'connected') clearInterval(waPolling);
    loadDashboard();
  }, 3000);
}

// ---------- Photos ----------
async function loadPhotos() {
  const batches = await api.get('/api/photos/batches');
  document.querySelector('#batches-table tbody').innerHTML = batches.map((b) => `
    <tr>
      <td>${b.id}</td><td>${b.label}</td>
      <td>${b.status === 'active' ? '<span class="pill ok">aktif</span>' : '<span class="pill warn">arsivlendi</span>'}</td>
      <td>${b.photo_count}</td><td>${b.created_at}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="muted">Arsiv yok</td></tr>';
}

async function uploadPhotos() {
  const input = document.getElementById('photo-input');
  const resultBox = document.getElementById('photo-upload-result');
  if (!input.files.length) { resultBox.textContent = 'Dosya secilmedi'; return; }
  const formData = new FormData();
  for (const f of input.files) formData.append('photos', f);
  resultBox.textContent = 'Yukleniyor...';
  try {
    const res = await fetch('/api/photos/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Hata');
    resultBox.textContent = `${data.uploaded} fotograf yuklendi.`;
    input.value = '';
    loadPhotos();
  } catch (e) {
    resultBox.textContent = 'Hata: ' + e.message;
  }
}

// ---------- Customers ----------
async function loadCustomers() {
  const customers = await api.get('/api/customers');
  document.querySelector('#customers-table tbody').innerHTML = customers.map((c) => `
    <tr>
      <td><input value="${c.name}" data-field="name" data-id="${c.id}" class="cust-edit" /></td>
      <td><input value="${c.whatsapp_number || ''}" data-field="whatsapp_number" data-id="${c.id}" class="cust-edit" /></td>
      <td><input value="${c.telegram_chat_id || ''}" data-field="telegram_chat_id" data-id="${c.id}" class="cust-edit" /></td>
      <td>
        <select data-field="platform" data-id="${c.id}" class="cust-edit">
          <option value="whatsapp" ${c.platform === 'whatsapp' ? 'selected' : ''}>WhatsApp</option>
          <option value="telegram" ${c.platform === 'telegram' ? 'selected' : ''}>Telegram</option>
          <option value="both" ${c.platform === 'both' ? 'selected' : ''}>Her ikisi</option>
        </select>
      </td>
      <td><input type="checkbox" data-field="active" data-id="${c.id}" class="cust-edit" ${c.active ? 'checked' : ''} /></td>
      <td class="muted small">/start ${c.telegram_link_code}</td>
      <td><button data-del="${c.id}" class="danger">Sil</button></td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="muted">Musteri yok</td></tr>';

  document.querySelectorAll('.cust-edit').forEach((el) => {
    el.addEventListener('change', async () => {
      const id = el.dataset.id;
      const field = el.dataset.field;
      const value = field === 'active' ? el.checked : el.value;
      await api.put(`/api/customers/${id}`, { [field]: value });
    });
  });
  document.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Musteri silinsin mi?')) return;
      await api.del(`/api/customers/${btn.dataset.del}`);
      loadCustomers();
    });
  });
}

async function addCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  const whatsapp_number = document.getElementById('cust-whatsapp').value.trim();
  const telegram_chat_id = document.getElementById('cust-telegram').value.trim();
  const platform = document.getElementById('cust-platform').value;
  if (!name) { alert('Isim gerekli'); return; }
  await api.post('/api/customers', { name, whatsapp_number, telegram_chat_id, platform });
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-whatsapp').value = '';
  document.getElementById('cust-telegram').value = '';
  loadCustomers();
}

// ---------- Schedule ----------
async function loadSchedule() {
  const { slots } = await api.get('/api/settings');
  const card = document.getElementById('slots-card');
  card.innerHTML = slots.map((s) => `
    <div class="slot-block" data-slot="${s.name}">
      <h4>${s.label}</h4>
      <div class="form-grid">
        <label>Aktif
          <input type="checkbox" data-field="enabled" ${s.enabled ? 'checked' : ''} />
        </label>
        <label>Saat (24s, HH:MM)
          <input type="text" data-field="time" value="${s.time}" />
        </label>
        <label>Musteri sayisi
          <input type="number" min="0" data-field="customer_count" value="${s.customer_count}" />
        </label>
        <label>Musteri basina fotograf
          <input type="number" min="1" data-field="photos_per_customer" value="${s.photos_per_customer}" />
        </label>
        <label>WhatsApp
          <input type="checkbox" data-field="platform_whatsapp" ${s.platforms.includes('whatsapp') ? 'checked' : ''} />
        </label>
        <label>Telegram
          <input type="checkbox" data-field="platform_telegram" ${s.platforms.includes('telegram') ? 'checked' : ''} />
        </label>
        <label>Mesaj sablonu da gonder
          <input type="checkbox" data-field="use_caption" ${s.use_caption ? 'checked' : ''} />
        </label>
      </div>
      <button class="slot-save-btn">Kaydet</button>
      <span class="muted small slot-save-result"></span>
    </div>
  `).join('');

  card.querySelectorAll('.slot-block').forEach((block) => {
    block.querySelector('.slot-save-btn').addEventListener('click', async () => {
      const name = block.dataset.slot;
      const get = (f) => block.querySelector(`[data-field="${f}"]`);
      const platforms = [];
      if (get('platform_whatsapp').checked) platforms.push('whatsapp');
      if (get('platform_telegram').checked) platforms.push('telegram');
      const payload = {
        enabled: get('enabled').checked ? 1 : 0,
        time: get('time').value.trim(),
        customer_count: parseInt(get('customer_count').value, 10) || 0,
        photos_per_customer: parseInt(get('photos_per_customer').value, 10) || 1,
        platforms: platforms.join(','),
        use_caption: get('use_caption').checked ? 1 : 0
      };
      await api.put(`/api/slots/${name}`, payload);
      block.querySelector('.slot-save-result').textContent = 'Kaydedildi.';
      setTimeout(() => { block.querySelector('.slot-save-result').textContent = ''; }, 2000);
    });
  });
}

// ---------- Captions ----------
async function loadCaptions() {
  renderCaptionList('whatsapp', 'cap-wa-list');
  renderCaptionList('telegram', 'cap-tg-list');
}

async function renderCaptionList(platform, listId) {
  const items = await api.get(`/api/captions/${platform}`);
  document.getElementById(listId).innerHTML = items.map((c) => `
    <li>
      <span>${c.text}</span>
      <span>
        <label class="small"><input type="checkbox" data-toggle="${c.id}" ${c.active ? 'checked' : ''} /> aktif</label>
        <button data-del="${c.id}" class="danger">Sil</button>
      </span>
    </li>
  `).join('') || '<li class="muted">Mesaj yok</li>';

  document.getElementById(listId).querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('change', async () => {
      await api.put(`/api/captions/${el.dataset.toggle}`, { active: el.checked });
    });
  });
  document.getElementById(listId).querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/captions/${btn.dataset.del}`);
      loadCaptions();
    });
  });
}

async function addCaption(platform) {
  const inputId = platform === 'whatsapp' ? 'cap-wa-text' : 'cap-tg-text';
  const input = document.getElementById(inputId);
  if (!input.value.trim()) return;
  await api.post(`/api/captions/${platform}`, { text: input.value.trim() });
  input.value = '';
  loadCaptions();
}

// ---------- Settings ----------
const SETTINGS_FIELDS = [
  { key: 'delay_min_sec', label: 'Min gecikme (sn)', type: 'number' },
  { key: 'delay_max_sec', label: 'Max gecikme (sn)', type: 'number' },
  { key: 'daily_send_cap_whatsapp', label: 'WhatsApp gunluk limit (0 = limitsiz)', type: 'number' },
  { key: 'daily_send_cap_telegram', label: 'Telegram gunluk limit (0 = limitsiz)', type: 'number' },
  { key: 'warmup_enabled', label: 'Isinma modu aktif (true/false)', type: 'text' },
  { key: 'warmup_days', label: 'Isinma suresi (gun)', type: 'number' },
  { key: 'warmup_max_per_day', label: 'Isinmada gunluk max WhatsApp', type: 'number' },
  { key: 'admin_telegram_chat_id', label: 'Admin Telegram chat id (bildirim icin)', type: 'text' }
];

async function loadSettings() {
  const { settings } = await api.get('/api/settings');
  const form = document.getElementById('settings-form');
  form.innerHTML = SETTINGS_FIELDS.map((f) => `
    <label>${f.label}
      <input type="${f.type}" data-key="${f.key}" value="${settings[f.key] ?? ''}" />
    </label>
  `).join('');
}

async function saveSettings() {
  const inputs = document.querySelectorAll('#settings-form [data-key]');
  const payload = {};
  inputs.forEach((el) => { payload[el.dataset.key] = el.value; });
  await api.post('/api/settings', { settings: payload });
  document.getElementById('settings-save-result').textContent = 'Kaydedildi.';
  setTimeout(() => { document.getElementById('settings-save-result').textContent = ''; }, 2000);
}

checkSession();
