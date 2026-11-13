const { db } = require('./_lib');

module.exports = async (req, res) => {
  try {
    const rows = await db()`select img from products where id = ${String(req.query.id || '')}`;
    const m = rows.length && /^data:(image\/jpeg);base64,(.+)$/s.exec(rows[0].img);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).send(Buffer.from(m[2], 'base64'));
  } catch (e) {
    res.status(500).end();
  }
};
