function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Giris gerekli' });
}

function login(req, res) {
  const { username, password } = req.body || {};
  const expectedUser = process.env.ADMIN_USERNAME || 'admin';
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedPass) {
    return res.status(500).json({ error: 'Sunucuda ADMIN_PASSWORD tanimli degil' });
  }
  if (username === expectedUser && password === expectedPass) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Kullanici adi veya sifre hatali' });
}

function logout(req, res) {
  req.session = null;
  res.json({ ok: true });
}

function sessionStatus(req, res) {
  res.json({ authed: !!(req.session && req.session.authed) });
}

module.exports = { requireAuth, login, logout, sessionStatus };
