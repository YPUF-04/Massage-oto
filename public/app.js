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

  document.getElementById('cust-wa-add-btn').addEventListener('click', () => addCustomer('whatsapp'));
  document.getElementById('cust-tg-add-btn').addEventListener('click', () => addCustomer('telegram'));

  document.getElementById('cap-wa-add').addEventListener('click', () => addCaption('whatsapp'));
  document.getElementById('cap-tg-add').addEventListener('click', () => addCaption('telegram'));

  document.getElementById('bc-send-btn').addEventListener('click', sendBroadcast);

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
  if (currentTab === 'customers') loadCustomers();
  if (currentTab === 'schedule') { loadPhotos(); loadSchedule(); }
  if (currentTab === 'captions') { loadCaptions(); loadBroadcastTab(); }
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
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Musteri</th><th>Gonderildi</th><th>Tamamlandi</th></tr></thead>
      <tbody>
        ${bp.customers.map((c) => `<tr><td>${c.customer.name}</td><td>${c.sent}/${c.total}</td><td>${c.completed ? 'Evet' : 'Hayir'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Musteri yok</td></tr>'}
      </tbody>
    </table></div>
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
  document.getElementById('run-log').innerHTML = runs.map(renderRunCard).join('') || '<p class="muted small">Henuz calisma yok</p>';
  document.querySelectorAll('.run-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => cancelRun(btn.dataset.runId));
  });
}

const KIND_LABELS = { slot: 'Fotograf Gonderimi', broadcast: 'Toplu Mesaj' };

function renderRunCard(r) {
  const inProgress = !r.finished_at;
  const kindLabel = KIND_LABELS[r.kind] || r.kind || r.slot_name;
  const total = r.total_targets || 0;
  const done = r.processed_targets || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (inProgress ? 0 : 100);
  const events = Array.isArray(r.details) ? r.details : [];
  const eventsHtml = events.slice(-40).reverse().map((ev) => {
    if (typeof ev === 'string') return `<div class="ev"><span>${escapeHtml(ev)}</span></div>`;
    return `<div class="ev"><span class="ev-time">${escapeHtml(ev.t || '')}</span><span>${ev.icon || ''} ${escapeHtml(ev.text || '')}</span></div>`;
  }).join('') || '<div class="muted small">Henuz kayit yok</div>';

  return `
    <div class="run-card">
      <div class="run-head">
        <div>
          <strong>${escapeHtml(kindLabel)}</strong>
          <span class="muted small">(${escapeHtml(r.slot_name)}) - basladi: ${escapeHtml(r.started_at)}</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${inProgress ? '<span class="pill warn">devam ediyor</span>' : (r.error_count > 0 ? '<span class="pill bad">hatali bitti</span>' : '<span class="pill ok">bitti</span>')}
          ${inProgress ? `<button class="danger run-cancel-btn" data-run-id="${r.id}">Iptal Et</button>` : ''}
        </div>
      </div>
      ${total > 0 ? `
        <div class="progress-bar"><div style="width:${pct}%"></div></div>
        <div class="muted small">${done}/${total} musteri islendi - ${pct}%</div>
      ` : ''}
      <div class="muted small" style="margin:6px 0;">Gonderim: <b>${r.sent_count}</b> &nbsp; Hata: <b>${r.error_count}</b></div>
      <div class="run-events">${eventsHtml}</div>
    </div>
  `;
}

async function cancelRun(runId) {
  if (!confirm('Bu calisma iptal edilsin mi? Kalan gonderimler yapilmayacak.')) return;
  try {
    await api.post(`/api/runs/${runId}/cancel`);
  } catch (e) {
    alert('Hata: ' + e.message);
  }
  loadDashboard();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
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

  loadCategoriesList();
}

async function loadCategoriesList() {
  const cats = await api.get('/api/categories');
  document.getElementById('categories-list').innerHTML = cats.map((c) => `
    <li>
      <span>${escapeHtml(c.name)} <span class="muted small">(${c.photo_count} foto)</span></span>
      <button data-del-cat="${c.id}" class="danger">Sil</button>
    </li>
  `).join('') || '<li class="muted">Henuz kategori yok. Fotograf yuklerken olusturabilirsin.</li>';

  document.querySelectorAll('[data-del-cat]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Kategori silinsin mi? Fotograflar silinmez, sadece etiket kaldirilir.')) return;
      await api.del(`/api/categories/${btn.dataset.delCat}`);
      loadCategoriesList();
    });
  });
}

async function uploadPhotos() {
  const input = document.getElementById('photo-input');
  const categories = document.getElementById('photo-categories').value;
  const resultBox = document.getElementById('photo-upload-result');
  if (!input.files.length) { resultBox.textContent = 'Dosya secilmedi'; return; }
  const formData = new FormData();
  for (const f of input.files) formData.append('photos', f);
  formData.append('categories', categories);
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

async function addCustomer(platform) {
  if (platform === 'whatsapp') {
    const name = document.getElementById('cust-wa-name').value.trim();
    const whatsapp_number = document.getElementById('cust-wa-number').value.trim();
    if (!name) { alert('Isim gerekli'); return; }
    if (!whatsapp_number) { alert('WhatsApp numarasi gerekli'); return; }
    await api.post('/api/customers', { name, whatsapp_number, platform: 'whatsapp' });
    document.getElementById('cust-wa-name').value = '';
    document.getElementById('cust-wa-number').value = '';
  } else {
    const name = document.getElementById('cust-tg-name').value.trim();
    if (!name) { alert('Isim gerekli'); return; }
    await api.post('/api/customers', { name, platform: 'telegram' });
    document.getElementById('cust-tg-name').value = '';
  }
  loadCustomers();
}

// ---------- Schedule ----------
let allCategoriesCache = [];
async function loadSchedule() {
  allCategoriesCache = await api.get('/api/categories');
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
        <label>Musteri sayisi (bu calismada)
          <input type="number" min="0" data-field="customer_count" value="${s.customer_count}" />
        </label>
        <label>WhatsApp
          <input type="checkbox" data-field="platform_whatsapp" ${s.platforms.includes('whatsapp') ? 'checked' : ''} />
        </label>
        <label>Telegram
          <input type="checkbox" data-field="platform_telegram" ${s.platforms.includes('telegram') ? 'checked' : ''} />
        </label>
      </div>

      <p class="muted small" style="margin-top:14px;">Gonderim sirasi: her secili musteri icin bu adimlar yukaridan asagiya sirayla calisir (orn. 20 foto -> indirim mesaji -> 20 foto -> yeni koleksiyon mesaji).</p>
      <div class="steps-editor" data-slot="${s.name}"></div>
      <button class="step-add-btn ghost" data-slot="${s.name}">+ Adim ekle</button>

      <div class="btn-row">
        <button class="slot-save-btn">Kaydet</button>
        <span class="muted small slot-save-result"></span>
      </div>
    </div>
  `).join('');

  for (const s of slots) {
    await loadSlotSteps(s.name);
  }

  card.querySelectorAll('.step-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => addStepRow(btn.dataset.slot, { type: 'photos', photo_count: 5, message_mode: 'random_caption', message_text: '' }));
  });

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
        platforms: platforms.join(',')
      };
      try {
        await api.put(`/api/slots/${name}`, payload);
        const steps = collectStepsFromEditor(name);
        await api.put(`/api/slots/${name}/steps`, { steps });
        block.querySelector('.slot-save-result').textContent = 'Kaydedildi.';
      } catch (e) {
        block.querySelector('.slot-save-result').textContent = 'Hata: ' + e.message;
      }
      setTimeout(() => { block.querySelector('.slot-save-result').textContent = ''; }, 3000);
    });
  });
}

async function loadSlotSteps(slotName) {
  const steps = await api.get(`/api/slots/${slotName}/steps`);
  const editor = document.querySelector(`.steps-editor[data-slot="${slotName}"]`);
  editor.innerHTML = '';
  (steps.length ? steps : [{ type: 'photos', photo_count: 5, message_mode: 'random_caption', message_text: '' }])
    .forEach((step) => appendStepRow(editor, step));
}

function appendStepRow(editor, step) {
  const row = document.createElement('div');
  row.className = 'step-row';
  const num = editor.children.length + 1;
  const stepCatIds = (step.category_ids || []).map(Number);
  const catCheckboxes = allCategoriesCache.map((c) => `
    <label class="small" style="display:inline-flex; gap:4px; align-items:center; margin-right:10px;">
      <input type="checkbox" data-cat-id="${c.id}" ${stepCatIds.includes(c.id) ? 'checked' : ''} /> ${escapeHtml(c.name)}
    </label>
  `).join('') || '<span class="muted small">Henuz kategori yok (Fotograflar sekmesinden ekleyebilirsin)</span>';

  row.innerHTML = `
    <div class="step-num">${num}</div>
    <div class="step-fields">
      <select data-field="type">
        <option value="photos" ${step.type === 'photos' ? 'selected' : ''}>Fotograf Blogu</option>
        <option value="message" ${step.type === 'message' ? 'selected' : ''}>Mesaj Blogu</option>
      </select>
      <input type="number" min="1" data-field="photo_count" value="${step.photo_count || 1}" placeholder="Adet" style="width:90px; ${step.type === 'message' ? 'display:none;' : ''}" />
      <select data-field="message_mode" style="${step.type === 'photos' ? 'display:none;' : ''}">
        <option value="random_caption" ${step.message_mode !== 'custom' ? 'selected' : ''}>Rastgele sablondan sec</option>
        <option value="custom" ${step.message_mode === 'custom' ? 'selected' : ''}>Ozel metin yaz</option>
      </select>
      <button class="step-up ghost" title="Yukari tasi">↑</button>
      <button class="step-down ghost" title="Asagi tasi">↓</button>
      <button class="step-del danger" title="Sil">Sil</button>
    </div>
    <div class="step-categories muted small" style="margin-top:6px; ${step.type === 'message' ? 'display:none;' : ''}">
      Kategori (secmezsen TUM fotograflardan): ${catCheckboxes}
    </div>
    <textarea data-field="message_text" placeholder="Ozel mesaj metni" style="${step.type === 'message' && step.message_mode === 'custom' ? '' : 'display:none;'}">${step.message_text || ''}</textarea>
  `;

  const typeSel = row.querySelector('[data-field="type"]');
  const countInput = row.querySelector('[data-field="photo_count"]');
  const modeSel = row.querySelector('[data-field="message_mode"]');
  const textArea = row.querySelector('[data-field="message_text"]');
  const catBox = row.querySelector('.step-categories');

  function syncVisibility() {
    const isMessage = typeSel.value === 'message';
    countInput.style.display = isMessage ? 'none' : '';
    modeSel.style.display = isMessage ? '' : 'none';
    catBox.style.display = isMessage ? 'none' : '';
    textArea.style.display = isMessage && modeSel.value === 'custom' ? '' : 'none';
  }
  typeSel.addEventListener('change', syncVisibility);
  modeSel.addEventListener('change', syncVisibility);

  row.querySelector('.step-del').addEventListener('click', () => { row.remove(); renumberSteps(editor); });
  row.querySelector('.step-up').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) editor.insertBefore(row, prev);
    renumberSteps(editor);
  });
  row.querySelector('.step-down').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) editor.insertBefore(next, row);
    renumberSteps(editor);
  });

  editor.appendChild(row);
}

function addStepRow(slotName, step) {
  const editor = document.querySelector(`.steps-editor[data-slot="${slotName}"]`);
  appendStepRow(editor, step);
}

function renumberSteps(editor) {
  editor.querySelectorAll('.step-row').forEach((row, idx) => {
    row.querySelector('.step-num').textContent = idx + 1;
  });
}

function collectStepsFromEditor(slotName) {
  const editor = document.querySelector(`.steps-editor[data-slot="${slotName}"]`);
  return Array.from(editor.querySelectorAll('.step-row')).map((row) => {
    const type = row.querySelector('[data-field="type"]').value;
    const categoryIds = Array.from(row.querySelectorAll('[data-cat-id]:checked')).map((el) => parseInt(el.dataset.catId, 10));
    return {
      type,
      photo_count: parseInt(row.querySelector('[data-field="photo_count"]').value, 10) || 1,
      message_mode: row.querySelector('[data-field="message_mode"]').value,
      message_text: row.querySelector('[data-field="message_text"]').value,
      category_ids: categoryIds
    };
  });
}

// ---------- Captions ----------
async function loadCaptions() {
  renderCaptionList('whatsapp', 'cap-wa-list');
  renderCaptionList('telegram', 'cap-tg-list');
  loadPreview();
}

async function loadPreview() {
  let photo = null;
  try {
    const batches = await api.get('/api/photos/batches');
    const active = batches.find((b) => b.status === 'active');
    if (active && active.photo_count > 0) {
      const photos = await api.get(`/api/photos/batches/${active.id}/photos`);
      photo = photos[0] || null;
    }
  } catch (e) { /* onizleme icin kritik degil */ }

  for (const platform of ['whatsapp', 'telegram']) {
    const box = document.getElementById(`preview-${platform}`);
    let captionText = '';
    try {
      const caps = await api.get(`/api/captions/${platform}`);
      const active = caps.filter((c) => c.active);
      if (active.length) captionText = active[Math.floor(Math.random() * active.length)].text;
    } catch (e) { /* onemli degil */ }

    if (!photo && !captionText) {
      box.innerHTML = '<div class="empty">Henuz fotograf veya mesaj sablonu yok.</div>';
      continue;
    }
    box.innerHTML = `
      <div class="bubble">
        ${photo ? `<img src="/api/photos/file/${encodeURI(photo.filepath)}" alt="onizleme" />` : ''}
        ${captionText ? `<div class="cap-text">${escapeHtml(captionText)}</div>` : ''}
      </div>
    `;
  }
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

// ---------- Toplu Mesaj (Broadcast) ----------
async function loadBroadcastTab() {
  const customers = await api.get('/api/customers');
  const box = document.getElementById('bc-customers');
  box.innerHTML = customers.map((c) => `
    <li>
      <label class="small" style="display:flex; gap:8px; align-items:center;">
        <input type="checkbox" class="bc-cust-check" value="${c.id}" />
        ${escapeHtml(c.name)} <span class="muted">(${c.platform}${c.whatsapp_number ? ', WA: ' + escapeHtml(c.whatsapp_number) : ''}${c.telegram_chat_id ? ', TG baglandi' : ''})</span>
      </label>
    </li>
  `).join('') || '<li class="muted">Musteri yok</li>';

  const selectAll = document.getElementById('bc-select-all');
  selectAll.checked = false;
  syncBroadcastCustomerBoxes();
  selectAll.onchange = syncBroadcastCustomerBoxes;
}

function syncBroadcastCustomerBoxes() {
  const selectAll = document.getElementById('bc-select-all').checked;
  document.querySelectorAll('.bc-cust-check').forEach((el) => {
    el.disabled = selectAll;
    if (selectAll) el.checked = false;
  });
}

async function sendBroadcast() {
  const platform = document.getElementById('bc-platform').value;
  const text = document.getElementById('bc-text').value.trim();
  const resultBox = document.getElementById('bc-result');
  if (!text) { resultBox.textContent = 'Mesaj metni bos olamaz'; return; }
  const allSelected = document.getElementById('bc-select-all').checked;
  const customerIds = allSelected ? [] : Array.from(document.querySelectorAll('.bc-cust-check:checked')).map((el) => parseInt(el.value, 10));
  if (!allSelected && !customerIds.length) {
    resultBox.textContent = 'En az bir musteri sec veya "Tum Musteriler" isaretle';
    return;
  }

  resultBox.textContent = 'Gonderiliyor...';
  try {
    await api.post('/api/broadcast', { platform, text, customerIds: customerIds.length ? customerIds : undefined });
    resultBox.textContent = 'Basladi. Ilerlemeyi "Panel" sekmesindeki Son Calismalar bolumunden izleyebilirsin.';
    document.getElementById('bc-text').value = '';
  } catch (e) {
    resultBox.textContent = 'Hata: ' + e.message;
  }
}

// ---------- Settings ----------
const SETTINGS_FIELDS = [
  { key: 'intra_step_delay_min_sec', label: 'Blok ici min gecikme (sn) - orn. 20 fotoluk blokta foto arasi', type: 'number' },
  { key: 'intra_step_delay_max_sec', label: 'Blok ici max gecikme (sn)', type: 'number' },
  { key: 'delay_min_sec', label: 'Bloklar/musteriler arasi min gecikme (sn) - anti-ban icin asil onemli olan budur', type: 'number' },
  { key: 'delay_max_sec', label: 'Bloklar/musteriler arasi max gecikme (sn)', type: 'number' },
  { key: 'daily_send_cap_whatsapp', label: 'WhatsApp gunluk farkli musteri limiti (orn. 30 = gunde en fazla 30 FARKLI musteriye gonderim, 0 = limitsiz)', type: 'number' },
  { key: 'daily_send_cap_telegram', label: 'Telegram gunluk farkli musteri limiti (0 = limitsiz)', type: 'number' },
  { key: 'warmup_enabled', label: 'Isinma modu aktif (true/false)', type: 'text' },
  { key: 'warmup_days', label: 'Isinma suresi (gun)', type: 'number' },
  { key: 'warmup_max_per_day', label: 'Isinmada gunluk max WhatsApp', type: 'number' },
  { key: 'admin_telegram_chat_id', label: 'Admin Telegram chat id (rapor/hata bildirimi icin, bota /myid yazarak ogrenebilirsin)', type: 'text' },
  { key: 'admin_notify_enabled', label: 'Admin Telegram bildirimleri aktif (true/false)', type: 'text' },
  { key: 'force_single_photo_send', label: 'Telegram foto gruplamayi kapat, tek tek gonder (true/false; false=normal, 10-10 gruplanir)', type: 'text' }
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
