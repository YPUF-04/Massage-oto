const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceAllowed } = require('../src/auth/serviceAuth');

const T = 'x'.repeat(40);
const H = `Bearer ${T}`;

test('izinli isler acik', () => {
  assert.equal(serviceAllowed('GET', '/status', H, T), true);
  assert.equal(serviceAllowed('GET', '/runs', H, T), true);
  assert.equal(serviceAllowed('POST', '/slots/morning/run-now', H, T), true);
  assert.equal(serviceAllowed('POST', '/automation', H, T), true);
  assert.equal(serviceAllowed('POST', '/runs/12/cancel', H, T), true);
});

test('musteri, toplu mesaj, ayar ve WhatsApp kapali', () => {
  for (const [m, p] of [['GET', '/customers'], ['POST', '/broadcast'], ['POST', '/settings'], ['POST', '/whatsapp/logout'], ['DELETE', '/customers/1'], ['POST', '/slots/x/run-now']]) {
    assert.equal(serviceAllowed(m, p, H, T), false, `${m} ${p}`);
  }
});

test('yanlis veya kisa anahtar reddedilir', () => {
  assert.equal(serviceAllowed('GET', '/status', 'Bearer yanlis', T), false);
  assert.equal(serviceAllowed('GET', '/status', 'Bearer kisa', 'kisa'), false);
  assert.equal(serviceAllowed('GET', '/status', undefined, T), false);
  assert.equal(serviceAllowed('GET', '/status', H, undefined), false);
});
