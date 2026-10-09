const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COLS = 'reg_no,bib_no,name,age,gender,category,event,payment_status';

async function sb(path, opt = {}) {
  const r = await fetch(SB + '/rest/v1/' + path, {
    ...opt,
    headers: { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opt.headers || {}) }
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error('DB: ' + ((j && j.message) || t));
  return j;
}

// Marks a pending registration as paid (a database trigger assigns BIB + reg no). Returns the entry or null.
async function markPaid(orderId, paymentId) {
  const o = encodeURIComponent(orderId);
  const rows = await sb('nt_registrations?razorpay_order_id=eq.' + o + '&payment_status=eq.pending&select=' + COLS, {
    method: 'PATCH',
    body: JSON.stringify({ payment_status: 'paid', razorpay_payment_id: paymentId, paid_at: new Date().toISOString() })
  });
  if (rows && rows.length) return rows[0];
  const ex = await sb('nt_registrations?razorpay_order_id=eq.' + o + '&payment_status=eq.paid&select=' + COLS);
  return ex && ex[0] ? ex[0] : null;
}

module.exports = { sb, markPaid, COLS };
