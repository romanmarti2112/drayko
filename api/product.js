// Solo dueño (cookie de sesión): crear/editar (POST) y borrar (DELETE) prendas.
const { db, isAuth, clean } = require('./_lib');
const MAX_IMG = 1_500_000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuth(req)) return res.status(401).json({ error: 'Iniciá sesión' });
  try {
    const q = db();
    if (req.method === 'DELETE') {
      await q`delete from products where id = ${String(req.query.id || '')}`;
      return res.status(200).json({ ok: true });
    }
    if (req.method !== 'POST') return res.status(405).end();

    const b = req.body || {};
    const n = clean(b.n, 70);
    if (!n) return res.status(400).json({ error: 'Falta el nombre' });
    let stock = null;
    if (b.stock && typeof b.stock === 'object') {
      stock = {};
      for (const [z, v] of Object.entries(b.stock)) {
        if (/^[A-Z0-9]{1,4}$/.test(z) && Number.isFinite(+v)) stock[z] = Math.max(0, Math.floor(+v));
      }
      if (!Object.keys(stock).length) stock = null;
    }
    const data = { n, c: clean(b.c, 30) || 'Remeras', p: clean(b.p, 12), d: clean(b.d, 200), stock };

    const id = b.id ? String(b.id) : null;
    let img = null;
    if (typeof b.img === 'string' && b.img.startsWith('data:image/jpeg;base64,')) {
      if (b.img.length > MAX_IMG) return res.status(400).json({ error: 'La foto es muy pesada' });
      img = b.img;
    }
    if (id) {
      const ex = await q`select id from products where id = ${id}`;
      if (!ex.length) return res.status(404).json({ error: 'No existe esa prenda' });
      if (img) await q`update products set data = ${JSON.stringify(data)}::jsonb, img = ${img}, updated_at = now() where id = ${id}`;
      else await q`update products set data = ${JSON.stringify(data)}::jsonb, updated_at = now() where id = ${id}`;
      return res.status(200).json({ ok: true, id });
    }
    if (!img) return res.status(400).json({ error: 'Subí una foto' });
    const nid = 'p' + Date.now().toString(36);
    await q`insert into products (id, pos, data, img) values (${nid}, (select coalesce(min(pos), 0) - 1 from products), ${JSON.stringify(data)}::jsonb, ${img})`;
    res.status(200).json({ ok: true, id: nid });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar' });
  }
};
