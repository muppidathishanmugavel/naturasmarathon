const { sb, cf } = require('./_lib');

const PH = /^[6-9]\d{9}$/;
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Hard cutoff: 25 October 2026 at 6:00:00 AM IST
const CUTOFF_MS = new Date('2026-10-25T06:00:00+05:30').getTime();

// Age on the event day (25 Oct 2026), calculated from the date of birth
function ageOn(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const b = new Date(dob + 'T00:00:00Z');
  if (isNaN(b) || b.toISOString().slice(0, 10) !== dob) return null;
  const y = b.getUTCFullYear(), m = b.getUTCMonth() + 1, d = b.getUTCDate();
  if (y < 1900) return null;
  const a = 2026 - y - (m > 10 || (m === 10 && d > 25) ? 1 : 0);
  return a < 0 ? null : a;
}

function category(event, age) {
  if (event === 'aanazhagan') return age >= 10 && age <= 17 ? 'AZ' : null;
  if (age >= 3 && age <= 6) return 'KIDS';
  if (age >= 7 && age <= 15) return 'M5';
  if (age >= 16 && age <= 99) return 'M7';
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    // 1. Enforce 6:00 AM IST cutoff
    if (Date.now() >= CUTOFF_MS) {
      return res.status(403).json({
        error: 'Online registration closed at 6:00 AM. You can register on the spot at the venue registration counter! / ஆன்லைன் பதிவு காலை 6:00 மணிக்கு நிறைவடைந்தது. நிகழ்வு மைதானத்தில் உள்ள கவுண்டரில் நேரடியாக (Spot Registration) பதிவு செய்து கொள்ளலாம்.'
      });
    }

    const missing = ['CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
    if (missing.length) return res.status(500).json({ error: 'Server setup incomplete. Missing in Vercel: ' + missing.join(', ') });

    const C = cf();
    const d = req.body || {};
    const event = d.event === 'aanazhagan' ? 'aanazhagan' : d.event === 'marathon' ? 'marathon' : null;
    const dob = s(d.date_of_birth, 10);
    const age = ageOn(dob);
    const aad = s(d.aadhaar_last4, 4);
    const name = s(d.name, 60), phone = s(d.phone, 10), city = s(d.city, 60);
    const gender = event === 'aanazhagan' ? 'M' : d.gender;
    if (!event) return res.status(400).json({ error: 'Invalid event' });
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (!['M', 'F'].includes(gender)) return res.status(400).json({ error: 'Invalid gender' });
    if (!PH.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    if (age === null) return res.status(400).json({ error: 'Please enter a valid date of birth' });
    if (!/^\d{4}$/.test(aad)) return res.status(400).json({ error: 'Please enter the last 4 digits of your Aadhaar' });
    const cat = category(event, age);
    if (!cat) return res.status(400).json({ error: 'Age does not match this event' });
    const amount = event === 'aanazhagan' ? 300 : 200;
    const orderId = 'NT' + Date.now() + Math.floor(Math.random() * 9000 + 1000);

    const r = await fetch(C.base + '/orders', {
      method: 'POST',
      headers: { ...C.headers, 'Content-Type': 'application/json' },
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
      body: JSON.stringify({ event, category: cat, name, age, date_of_birth: dob, aadhaar_last4: aad, gender, phone, city: city || null, amount, payment_status: 'pending', razorpay_order_id: orderId })
    });
    res.status(200).json({ order_id: orderId, payment_session_id: o.payment_session_id, mode: C.mode });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Something went wrong: ' + String(e.message).slice(0, 160) });
  }
};
