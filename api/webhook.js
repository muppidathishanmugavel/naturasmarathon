// Safety net: if the user closes the browser right after paying, Cashfree calls this URL.
// We never trust the call itself - we only read the order id from it and ask Cashfree directly whether that order is PAID.
const { markPaid } = require('./_lib');

const BASE = process.env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const H = () => ({
  'x-client-id': String(process.env.CASHFREE_APP_ID || '').trim(),
  'x-client-secret': String(process.env.CASHFREE_SECRET_KEY || '').trim(),
  'x-api-version': '2023-08-01'
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    const orderId = b && b.data && b.data.order && b.data.order.order_id;
    if (!/^NT\d{10,}$/.test(String(orderId || ''))) return res.status(200).json({ ok: true }); // test ping or unknown event

    const r = await fetch(BASE + '/orders/' + orderId, { headers: H() });
    const o = await r.json().catch(() => ({}));
    if (r.ok && o.order_status === 'PAID') {
      let payId = orderId;
      try {
        const pr = await fetch(BASE + '/orders/' + orderId + '/payments', { headers: H() });
        const list = await pr.json();
        const ok = Array.isArray(list) && list.find((p) => p.payment_status === 'SUCCESS');
        if (ok) payId = String(ok.cf_payment_id);
      } catch (e) { /* keep order id as the reference */ }
      await markPaid(orderId, payId);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).end(); // lets Cashfree retry
  }
};
