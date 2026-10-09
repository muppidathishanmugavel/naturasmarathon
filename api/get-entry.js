const { sb, COLS } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const phone = String((req.body || {}).phone || '').trim();
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number' });
    const rows = await sb('nt_registrations?phone=eq.' + phone + '&payment_status=eq.paid&select=' + COLS + '&order=bib_no.asc');
    res.status(200).json({ entries: rows || [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not fetch entry' });
  }
};
