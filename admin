// Single admin API (keeps the Vercel function count low). All actions except "login" need a valid token.
const crypto = require('crypto');
const { sb } = require('./_lib');

const PW = () => process.env.ADMIN_PASSWORD || '';
const sign = (p) => crypto.createHmac('sha256', PW()).update(p).digest('base64url');
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const COLS = 'bib_no,reg_no,name,age,gender,category,event,phone,city,amount,payment_status,paid_at,attended_at,finish_at,created_at';

function makeToken() {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
  return p + '.' + sign(p);
}
function okToken(h) {
  const t = String(h || '').replace(/^Bearer /, '');
  const [p, s] = t.split('.');
  if (!p || !s) return false;
  const e = sign(p);
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

async function allRows(includeUnpaid) {
  const out = [];
  for (let from = 0; from < 10000; from += 1000) {
    const q = 'nt_registrations?select=' + COLS + '&order=created_at.asc' + (includeUnpaid ? '' : '&payment_status=eq.paid');
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
      if (!crypto.timingSafeEqual(sha(b.password || ''), sha(PW()))) return res.status(401).json({ error: 'Wrong password' });
      return res.status(200).json({ token: makeToken() });
    }
    if (!okToken(req.headers.authorization)) return res.status(401).json({ error: 'Please login again' });

    if (a === 'list') {
      const rows = await allRows(!!b.all);
      const race = await sb('nt_race?select=category,started_at');
      return res.status(200).json({ rows, race, now: new Date().toISOString() });
    }

    if (a === 'race-start' || a === 'race-reset') {
      const c = b.category;
      if (!['M7', 'M5', 'KIDS'].includes(c)) return res.status(400).json({ error: 'Invalid category' });
      if (a === 'race-start') {
        const ex = await sb('nt_race?category=eq.' + c + '&select=started_at');
        if (ex.length) return res.status(409).json({ error: 'Already started' });
        await sb('nt_race', { method: 'POST', body: JSON.stringify({ category: c, started_at: new Date().toISOString() }) });
      } else {
        await sb('nt_race?category=eq.' + c, { method: 'DELETE' });
        await sb('nt_registrations?category=eq.' + c + '&finish_at=not.is.null', { method: 'PATCH', body: JSON.stringify({ finish_at: null }) });
      }
      return res.status(200).json({ ok: true });
    }

    if (['attend', 'unattend', 'finish', 'unfinish'].includes(a)) {
      const bib = parseInt(b.bib, 10);
      if (!bib) return res.status(400).json({ error: 'Enter a BIB number' });
      const base = 'nt_registrations?bib_no=eq.' + bib + '&payment_status=eq.paid';
      const cur = (await sb(base + '&select=' + COLS))[0];
      if (!cur) return res.status(404).json({ error: 'BIB ' + bib + ' not found (not registered or not paid)' });

      if (a === 'attend' || a === 'unattend') {
        if (a === 'attend' && cur.attended_at) return res.status(200).json({ entry: cur, already: true });
        const u = await sb(base + '&select=' + COLS, { method: 'PATCH', body: JSON.stringify({ attended_at: a === 'attend' ? new Date().toISOString() : null }) });
        return res.status(200).json({ entry: u[0] || cur });
      }

      if (cur.category === 'AZ') return res.status(400).json({ error: 'Bodybuilding has no timed race' });
      const st = (await sb('nt_race?category=eq.' + cur.category + '&select=started_at'))[0];
      if (a === 'unfinish') {
        const u = await sb(base + '&select=' + COLS, { method: 'PATCH', body: JSON.stringify({ finish_at: null }) });
        return res.status(200).json({ entry: u[0] || cur });
      }
      if (!st) return res.status(400).json({ error: 'Race not started for this category yet' });
      const start = new Date(st.started_at).getTime();
      if (cur.finish_at) return res.status(200).json({ entry: cur, already: true, elapsed: new Date(cur.finish_at).getTime() - start });
      const u = await sb(base + '&finish_at=is.null&select=' + COLS, { method: 'PATCH', body: JSON.stringify({ finish_at: new Date().toISOString() }) });
      const e = u[0] || cur;
      return res.status(200).json({ entry: e, elapsed: new Date(e.finish_at).getTime() - start });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error: ' + String(e.message).slice(0, 160) });
  }
};
