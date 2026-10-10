const { markPaid } = require('./_lib');

const BASE = process.env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const H = () => ({
  'x-client-id': String(process.env.CASHFREE_APP_ID || '').trim(),
  'x-client-secret': String(process.env.CASHFREE_SECRET_KEY || '').trim(),
  'x-api-version': '2023-08-01'
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const orderId = String((req.body || {}).order_id || '');
    if (!/^NT\d{10,}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order' });

    // Ask Cashfree directly - never trust the browser
    const r = await fetch(BASE + '/orders/' + orderId, { headers: H() });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: 'Could not check payment status' });
    if (o.order_status !== 'PAID') return res.status(402).json({ error: 'Payment not confirmed yet' });

    let payId = orderId;
    try {
      const pr = await fetch(BASE + '/orders/' + orderId + '/payments', { headers: H() });
      const list = await pr.json();
      const ok = Array.isArray(list) && list.find((p) => p.payment_status === 'SUCCESS');
      if (ok) payId = String(ok.cf_payment_id);
    } catch (e) { /* keep order id as the reference */ }

    const entry = await markPaid(orderId, payId);
    if (!entry) return res.status(404).json({ error: 'Registration not found' });
    res.status(200).json(entry);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not confirm registration' });
  }
};
