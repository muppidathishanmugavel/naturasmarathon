const { sb } = require('./_lib');

const PROD = process.env.CASHFREE_ENV === 'production';
const BASE = PROD ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const PH = /^[6-9]\d{9}$/;
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function category(event, age) {
  if (event === 'aanazhagan') return age >= 10 && age <= 18 ? 'AZ' : null;
  if (age >= 3 && age <= 6) return 'KIDS';
  if (age >= 7 && age <= 15) return 'M5';
  if (age >= 16 && age <= 99) return 'M7';
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const missing = ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return res.status(500).json({ error: 'Server setup incomplete. Missing in Vercel: ' + missing.join(', ') });

    const d = req.body || {};
    const event = d.event === 'aanazhagan' ? 'aanazhagan' : d.event === 'marathon' ? 'marathon' : null;
    const age = parseInt(d.age, 10);
    const name = s(d.name, 60), phone = s(d.phone, 10), city = s(d.city, 60);
    const gender = event === 'aanazhagan' ? 'M' : d.gender;
    if (!event) return res.status(400).json({ error: 'Invalid event' });
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (!['M', 'F'].includes(gender)) return res.status(400).json({ error: 'Invalid gender' });
    if (!PH.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    const cat = isNaN(age) ? null : category(event, age);
    if (!cat) return res.status(400).json({ error: 'Age does not match this event' });
    const amount = event === 'aanazhagan' ? 300 : 200;
    const orderId = 'NT' + Date.now() + Math.floor(Math.random() * 9000 + 1000);

    const r = await fetch(BASE + '/orders', {
      method: 'POST',
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID.trim(),
        'x-client-secret': process.env.CASHFREE_SECRET_KEY.trim(),
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: { customer_id: 'NT_' + phone, customer_phone: phone, customer_name: name },
        order_meta: { notify_url: 'https://' + req.headers.host + '/api/webhook' },
        order_note: 'Registration ' + cat
      })
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok || !o.payment_session_id) {
      console.error('Cashfree error', r.status, JSON.stringify(o));
      return res.status(502).json({ error: 'Payment gateway error: ' + (o.message || 'HTTP ' + r.status) });
    }

    await sb('nt_registrations', {
      method: 'POST',
      body: JSON.stringify({ event, category: cat, name, age, gender, phone, city: city || null, amount, payment_status: 'pending', razorpay_order_id: orderId })
    });
    res.status(200).json({ order_id: orderId, payment_session_id: o.payment_session_id, mode: PROD ? 'production' : 'sandbox' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong: ' + String(e.message).slice(0, 160) });
  }
};
