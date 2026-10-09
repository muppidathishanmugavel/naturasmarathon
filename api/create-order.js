const { sb } = require('./_lib');

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
    const missing = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
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

    const keyId = process.env.RAZORPAY_KEY_ID.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET.trim();
    const auth = 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amount * 100, currency: 'INR', receipt: 'nt_' + Date.now(), notes: { name, phone, category: cat } })
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Razorpay error', r.status, JSON.stringify(o));
      const why = (o.error && o.error.description) || 'HTTP ' + r.status;
      return res.status(502).json({ error: 'Payment gateway error: ' + why });
    }

    await sb('nt_registrations', {
      method: 'POST',
      body: JSON.stringify({ event, category: cat, name, age, gender, phone, city: city || null, amount, payment_status: 'pending', razorpay_order_id: o.id })
    });
    res.status(200).json({ order_id: o.id, amount: amount * 100, key_id: keyId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong: ' + String(e.message).slice(0, 160) });
  }
};
