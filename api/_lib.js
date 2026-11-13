const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const db = () => neon(process.env.DATABASE_URL);
const key = () => (process.env.ADMIN_SECRET || '') + '|' + (process.env.ADMIN_PASSWORD || '');
const sign = (exp) => crypto.createHmac('sha256', key()).update('adm:' + exp).digest('hex');

const makeToken = () => { const exp = Date.now() + 12 * 3600e3; return exp + '.' + sign(exp); };

function isAuth(req) {
  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SECRET) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function passOk(p) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(p), h(process.env.ADMIN_PASSWORD));
}

const clean = (v, max) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, max);

module.exports = { db, makeToken, isAuth, passOk, clean };
