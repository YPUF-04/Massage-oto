// SharedMind servis girisi: Authorization: Bearer <SERVICE_TOKEN>.
// Sadece asagidaki isler acik. Musteri, foto, ayar ve toplu mesaj KAPALI.
const crypto = require('crypto');

const ALLOWED = [
  ['GET', /^\/status$/],
  ['GET', /^\/runs$/],
  ['GET', /^\/slots$/],
  ['GET', /^\/automation$/],
  ['POST', /^\/automation$/],
  ['POST', /^\/slots\/(morning|afternoon|evening)\/run-now$/],
  ['POST', /^\/runs\/\d+\/cancel$/]
];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function tokenOk(header, token) {
  if (!token || token.length < 32) return false;
  const m = /^Bearer (.+)$/.exec(header || '');
  if (!m) return false;
  return crypto.timingSafeEqual(sha(m[1]), sha(token));
}

function serviceAllowed(method, path, header, token = process.env.SERVICE_TOKEN) {
  if (!tokenOk(header, token)) return false;
  return ALLOWED.some(([m, re]) => m === method && re.test(path));
}

// requireAuth'tan once calisir. Gecerli anahtar + izinli yol -> req.service = true.
function serviceAuth(req, res, next) {
  if (!req.headers.authorization) return next();
  if (serviceAllowed(req.method, req.path, req.headers.authorization)) {
    req.service = true;
    return next();
  }
  return res.status(403).json({ error: 'Servis girisi bu islem icin kapali' });
}

module.exports = { serviceAllowed, serviceAuth };
