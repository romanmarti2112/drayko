// Público: devuelve el catálogo [nombre, categoría, precio, descripción, stock, foto, id]
const { db } = require('./_lib');
const DEFAULTS = require('./_defaults');

module.exports = async (req, res) => {
  try {
    const q = db();
    const seeded = await q`select v from meta where k = 'seeded'`;
    if (!seeded.length) {
      for (let i = 0; i < DEFAULTS.length; i++) {
        const [n, c, p, d] = DEFAULTS[i];
        await q`insert into products (id, pos, data, img) values (${'p' + (i + 1)}, ${i}, ${JSON.stringify({ n, c, p, d, stock: null })}::jsonb, ${'img/p' + (i + 1) + '.jpg'}) on conflict do nothing`;
      }
      await q`insert into meta (k, v) values ('seeded', '1') on conflict do nothing`;
    }
    const rows = await q`select id, data, img, extract(epoch from updated_at)::bigint as t from products order by pos asc`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(rows.map((r) => [
      r.data.n, r.data.c, r.data.p, r.data.d, r.data.stock || null,
      r.img.startsWith('data:') ? `/api/img?id=${r.id}&v=${r.t}` : r.img, r.id,
    ]));
  } catch (e) {
    res.status(500).json({ error: 'No se pudo leer el catálogo' });
  }
};
