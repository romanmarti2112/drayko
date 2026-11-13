const { makeToken, isAuth, passOk } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: isAuth(req) });
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'adm=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0');
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).end();
  const pass = req.body && req.body.password;
  if (typeof pass !== 'string' || !passOk(pass)) {
    await new Promise((r) => setTimeout(r, 1000)); // frena los intentos al azar
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  res.setHeader('Set-Cookie', `adm=${makeToken()}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${12 * 3600}`);
  res.status(200).json({ ok: true });
};
