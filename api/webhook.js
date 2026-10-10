// Safety net: marks the payment as paid even if the user closes the browser right after paying.
const crypto = require('crypto');
const { markPaid } = require('./_lib');

function raw(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined) return resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => resolve(t));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = await raw(req);
    const ts = String(req.headers['x-webhook-timestamp'] || '');
    const got = String(req.headers['x-webhook-signature'] || '');
    const exp = crypto.createHmac('sha256', String(process.env.CASHFREE_SECRET_KEY || '').trim()).update(ts + body).digest('base64');
    if (!got || exp.length !== got.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(got))) return res.status(400).end();
    const ev = JSON.parse(body);
    const d = ev.data || {};
    if (ev.type === 'PAYMENT_SUCCESS_WEBHOOK' && d.order && d.order.order_id) {
      await markPaid(d.order.order_id, String((d.payment && d.payment.cf_payment_id) || d.order.order_id));
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
};
module.exports.config = { api: { bodyParser: false } };
