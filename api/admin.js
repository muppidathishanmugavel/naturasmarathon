// Single admin API (keeps the Vercel function count low).
// Two roles: "admin" (everything, incl. stopwatch) and "organiser" (attendance, finish-line, and spot registration).
const crypto = require('crypto');
const { sb } = require('./_lib');

const PW = () => process.env.ADMIN_PASSWORD || '';
const OP = () => process.env.ORGANISER_PASSWORD || '';
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (p) => crypto.createHmac('sha256', PW()).update(p).digest('base64url');

const COLS = 'bib_no,reg_no,name,age,date_of_birth,aadhaar_last4,gender,category,event,phone,city,amount,payment_status,paid_at,attended_at,finish_at,created_at,reminders,razorpay_payment_id';
const ORG_COLS = 'bib_no,reg_no,name,age,gender,category,payment_status,attended_at,finish_at,razorpay_payment_id';
const ADMIN_ONLY = ['race-start', 'race-stop', 'race-resume', 'race-reset', 'remind-mark'];

function makeToken(role) {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 14 * 3600 * 1000, role })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(h) {
  const t = String(h || '').replace(/^Bearer /, '');
  const [p, s] = t.split('.');
  if (!p || !s) return null;
  const e = sign(p);
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try {
    const j = JSON.parse(Buffer.from(p, 'base64url').toString());
    return j.exp > Date.now() && ['admin', 'organiser'].includes(j.role) ? j : null;
  } catch { return null; }
}

async function allRows(includeUnpaid, cols) {
  const out = [];
  for (let from = 0; from < 10000; from += 1000) {
    const q = 'nt_registrations?select=' + cols + '&order=created_at.asc' + (includeUnpaid ? '' : '&payment_status=eq.paid');
    const page = await sb(q, { headers: { 'Range-Unit': 'items', Range: from + '-' + (from + 999) } });
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (PW().length < 6) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in Vercel (min 6 characters)' });
    const b = req.body || {}, a = b.action;

    if (a === 'login') {
      await new Promise((r) => setTimeout(r, 600));
      const pw = String(b.password || '');
      const role = same(pw, PW()) ? 'admin' : (OP().length >= 6 && same(pw, OP())) ? 'organiser' : null;
      if (!role) return res.status(401).json({ error: 'Wrong password' });
      return res.status(200).json({ token: makeToken(role), role });
    }

    const user = readToken(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Please login again' });
    const isAdmin = user.role === 'admin';
    if (ADMIN_ONLY.includes(a) && !isAdmin) return res.status(403).json({ error: 'Only the admin can perform this action' });

    if (a === 'list') {
      const rows = await allRows(isAdmin && !!b.all, isAdmin ? COLS : ORG_COLS);
      const race = await sb('nt_race?select=category,started_at,stopped_at');
      return res.status(200).json({ rows, race, now: new Date().toISOString(), role: user.role });
    }

    // Spot Registration Handler (Used simultaneously by Admin or Organisers at desks)
    if (a === 'spot-reg') {
      const bib = parseInt(b.bib_no, 10);
      if (!bib || bib < 1 || bib > 999) return res.status(400).json({ error: 'Enter a valid BIB number between 1 and 999' });

      const name = String(b.name || '').trim();
      const phone = String(b.phone || '').trim().replace(/\D/g, '').slice(-10);
      const category = String(b.category || '').trim();
      if (!name) return res.status(400).json({ error: 'Participant name is required' });
      if (!phone || phone.length !== 10) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
      if (!['M7', 'M5', 'KIDS', 'AZ'].includes(category)) return res.status(400).json({ error: 'Invalid category selected' });

      // 1. Concurrency Check: Ensure BIB is not already assigned
      const existing = await sb('nt_registrations?bib_no=eq.' + bib + '&select=bib_no,name,category,payment_status');
      if (existing && existing.length > 0) {
        return res.status(409).json({ error: 'BIB #' + bib + ' is already assigned to ' + existing[0].name + ' (' + existing[0].category + ')!' });
      }

      const eventNames = {
        M7: '7 KM Marathon',
        M5: '5 KM Marathon',
        KIDS: 'Kids Indoor Marathon',
        AZ: 'Bodybuilding Championship'
      };

      const payMode = String(b.payment_mode || 'Cash').trim();
      const payRef = String(b.payment_ref || '').trim();
      const payRecord = 'SPOT_' + payMode.toUpperCase().replace(/\s+/g, '_') + (payRef ? ':' + payRef : '');

      const newRow = {
        bib_no: bib,
        reg_no: 'NT-SPOT-' + bib,
        name: name,
        age: parseInt(b.age, 10) || null,
        date_of_birth: b.dob ? String(b.dob).trim() : null,
        gender: b.gender === 'F' ? 'F' : 'M',
        category: category,
        event: eventNames[category] || category,
        phone: phone,
        city: String(b.city || '').trim(),
        amount: parseFloat(b.amount) || 0,
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        attended_at: b.attended ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        razorpay_payment_id: payRecord,
        reminders: 'SPOT,' + payMode
      };

      const inserted = await sb('nt_registrations', {
        method: 'POST',
        body: JSON.stringify(newRow)
      });

      return res.status(200).json({ ok: true, entry: inserted[0] || newRow });
    }

    if (a === 'remind-mark') {
      const bib = parseInt(b.bib, 10), tag = String(b.tag || '');
      if (!bib || !['D10', 'D5', 'D2', 'D1'].includes(tag)) return res.status(400).json({ error: 'Invalid reminder' });
      const q = 'nt_registrations?bib_no=eq.' + bib + '&payment_status=eq.paid';
      const cur = (await sb(q + '&select=reminders'))[0];
      if (!cur) return res.status(404).json({ error: 'BIB not found' });
      const set = new Set(String(cur.reminders || '').split(',').filter(Boolean)); set.add(tag);
      await sb(q, { method: 'PATCH', body: JSON.stringify({ reminders: [...set].join(',') }) });
      return res.status(200).json({ ok: true });
    }

    if (ADMIN_ONLY.includes(a)) {
      const c = b.category;
      if (!['M7', 'M5', 'KIDS'].includes(c)) return res.status(400).json({ error: 'Invalid category' });
      const ex = (await sb('nt_race?category=eq.' + c + '&select=started_at,stopped_at'))[0];
      if (a === 'race-start') {
        if (ex) return res.status(409).json({ error: 'Already started' });
        await sb('nt_race', { method: 'POST', body: JSON.stringify({ category: c, started_at: new Date().toISOString() }) });
      } else if (a === 'race-stop') {
        if (!ex) return res.status(400).json({ error: 'Not started yet' });
        if (!ex.stopped_at) await sb('nt_race?category=eq.' + c, { method: 'PATCH', body: JSON.stringify({ stopped_at: new Date().toISOString() }) });
      } else if (a === 'race-resume') {
        if (ex && ex.stopped_at) await sb('nt_race?category=eq.' + c, { method: 'PATCH', body: JSON.stringify({ stopped_at: null }) });
      } else { // race-reset
        await sb('nt_race?category=eq.' + c, { method: 'DELETE' });
        await sb('nt_registrations?category=eq.' + c + '&finish_at=not.is.null', { method: 'PATCH', body: JSON.stringify({ finish_at: null }) });
      }
      return res.status(200).json({ ok: true });
    }

    if (['attend', 'unattend', 'finish', 'unfinish'].includes(a)) {
      const bib = parseInt(b.bib, 10);
      if (!bib) return res.status(400).json({ error: 'Enter a BIB number' });
      const base = 'nt_registrations?bib_no=eq.' + bib + '&payment_status=eq.paid';
      const sel = '&select=' + ORG_COLS;
      const cur = (await sb(base + sel))[0];
      if (!cur) return res.status(404).json({ error: 'BIB ' + bib + ' not found (not registered or not paid)' });

      if (a === 'attend' || a === 'unattend') {
        if (a === 'attend' && cur.attended_at) return res.status(200).json({ entry: cur, already: true });
        const u = await sb(base + sel, { method: 'PATCH', body: JSON.stringify({ attended_at: a === 'attend' ? new Date().toISOString() : null }) });
        return res.status(200).json({ entry: u[0] || cur });
      }

      if (cur.category === 'AZ') return res.status(400).json({ error: 'Bodybuilding has no timed race' });
      if (a === 'unfinish') {
        const u = await sb(base + sel, { method: 'PATCH', body: JSON.stringify({ finish_at: null }) });
        return res.status(200).json({ entry: u[0] || cur });
      }
      const st = (await sb('nt_race?category=eq.' + cur.category + '&select=started_at,stopped_at'))[0];
      if (!st) return res.status(400).json({ error: 'Race not started for this category yet' });
      if (st.stopped_at) return res.status(400).json({ error: 'The race clock is stopped. Ask the admin to resume it.' });
      const start = new Date(st.started_at).getTime();
      if (cur.finish_at) return res.status(200).json({ entry: cur, already: true, elapsed: new Date(cur.finish_at).getTime() - start });
      const u = await sb(base + '&finish_at=is.null' + sel, { method: 'PATCH', body: JSON.stringify({ finish_at: new Date().toISOString() }) });
      const e = u[0] || cur;
      return res.status(200).json({ entry: e, elapsed: new Date(e.finish_at).getTime() - start });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error: ' + String(e.message).slice(0, 160) });
  }
};
