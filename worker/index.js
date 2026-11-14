// Cloudflare Worker: API del catálogo (/api/*). El resto lo sirven los archivos estáticos.
import { neon } from '@neondatabase/serverless';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import DEFAULTS from '../api/_defaults.js';

const MAX_IMG = 1_500_000;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

const sign = (env, exp) => createHmac('sha256', (env.ADMIN_SECRET || '') + '|' + (env.ADMIN_PASSWORD || '')).update('adm:' + exp).digest('hex');
const makeToken = (env) => { const exp = Date.now() + 12 * 3600e3; return exp + '.' + sign(env, exp); };

function isAuth(req, env) {
  if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.get('cookie') || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(env, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}
function passOk(env, p) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = (x) => createHash('sha256').update(String(x)).digest();
  return timingSafeEqual(h(p), h(env.ADMIN_PASSWORD));
}
const clean = (v, max) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, max);
const body = (req) => req.json().catch(() => ({}));

async function products(env) {
  const q = neon(env.DATABASE_URL);
  let rows = await q`select id, data, img, extract(epoch from updated_at)::bigint as t from products order by pos asc`;
  if (!rows.length) {
    const seeded = await q`select v from meta where k = 'seeded'`;
    if (!seeded.length) {
      for (let i = 0; i < DEFAULTS.length; i++) {
        const [n, c, p, d] = DEFAULTS[i];
        await q`insert into products (id, pos, data, img) values (${'p' + (i + 1)}, ${i}, ${JSON.stringify({ n, c, p, d, stock: null })}::jsonb, ${'img/p' + (i + 1) + '.jpg'}) on conflict do nothing`;
      }
      await q`insert into meta (k, v) values ('seeded', '1') on conflict do nothing`;
      rows = await q`select id, data, img, extract(epoch from updated_at)::bigint as t from products order by pos asc`;
    }
  }
  return json(rows.map((r) => [
    r.data.n, r.data.c, r.data.p, r.data.d, r.data.stock || null,
    r.img.startsWith('data:') ? `/api/img?id=${r.id}&v=${r.t}` : r.img, r.id,
  ]), 200, { 'Cache-Control': 'public, max-age=10' });
}

async function img(env, url) {
  const rows = await neon(env.DATABASE_URL)`select img from products where id = ${url.searchParams.get('id') || ''}`;
  const m = rows.length && /^data:(image\/jpeg);base64,(.+)$/s.exec(rows[0].img);
  if (!m) return new Response(null, { status: 404 });
  return new Response(Buffer.from(m[2], 'base64'), { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}

async function login(req, env) {
  if (req.method === 'GET') return json({ ok: isAuth(req, env) });
  if (req.method === 'DELETE') return json({ ok: true }, 200, { 'Set-Cookie': 'adm=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0' });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const q = neon(env.DATABASE_URL), ip = req.headers.get('CF-Connecting-IP') || 'x';
  const [{ n }] = await q`select count(*)::int as n from login_attempts where ip = ${ip} and ts > now() - interval '15 minutes'`;
  if (n >= 8) return json({ error: 'Demasiados intentos. Esperá 15 minutos.' }, 429);
  const pass = (await body(req)).password;
  if (typeof pass !== 'string' || !passOk(env, pass)) {
    await q`insert into login_attempts (ip) values (${ip})`;
    await q`delete from login_attempts where ts < now() - interval '1 day'`;
    await new Promise((r) => setTimeout(r, 1000));
    return json({ error: 'Contraseña incorrecta' }, 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': `adm=${makeToken(env)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${12 * 3600}` });
}

async function product(req, env, url) {
  if (!isAuth(req, env)) return json({ error: 'Iniciá sesión' }, 401);
  const q = neon(env.DATABASE_URL);
  if (req.method === 'DELETE') {
    await q`delete from products where id = ${url.searchParams.get('id') || ''}`;
    return json({ ok: true });
  }
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const b = await body(req);
  const n = clean(b.n, 70);
  if (!n) return json({ error: 'Falta el nombre' }, 400);
  let stock = null;
  if (b.stock && typeof b.stock === 'object') {
    stock = {};
    for (const [z, v] of Object.entries(b.stock)) if (/^[A-Z0-9]{1,4}$/.test(z) && Number.isFinite(+v)) stock[z] = Math.max(0, Math.floor(+v));
    if (!Object.keys(stock).length) stock = null;
  }
  const data = { n, c: clean(b.c, 30) || 'Remeras', p: clean(b.p, 12), d: clean(b.d, 200), stock };
  const id = b.id ? String(b.id) : null;
  let image = null;
  if (typeof b.img === 'string' && b.img.startsWith('data:image/jpeg;base64,')) {
    if (b.img.length > MAX_IMG) return json({ error: 'La foto es muy pesada' }, 400);
    image = b.img;
  }
  if (id) {
    const ex = await q`select id from products where id = ${id}`;
    if (!ex.length) return json({ error: 'No existe esa prenda' }, 404);
    if (image) await q`update products set data = ${JSON.stringify(data)}::jsonb, img = ${image}, updated_at = now() where id = ${id}`;
    else await q`update products set data = ${JSON.stringify(data)}::jsonb, updated_at = now() where id = ${id}`;
    return json({ ok: true, id });
  }
  if (!image) return json({ error: 'Subí una foto' }, 400);
  const nid = 'p' + Date.now().toString(36);
  await q`insert into products (id, pos, data, img) values (${nid}, (select coalesce(min(pos), 0) - 1 from products), ${JSON.stringify(data)}::jsonb, ${image})`;
  return json({ ok: true, id: nid });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case '/api/products': return await products(env);
        case '/api/img': return await img(env, url);
        case '/api/login': return await login(req, env);
        case '/api/product': return await product(req, env, url);
      }
      return new Response(null, { status: 404 });
    } catch (e) {
      return json({ error: 'Error del servidor' }, 500);
    }
  },
};
