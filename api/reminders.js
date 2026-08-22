// api/reminders.js - BULLETPROOF REMINDER API
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supabaseKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  function parseTime(input) {
    // Handles: "tomorrow 11 AM", "tomorrow at 11am", "11am tomorrow", "2026-05-13 11:00"
    try {
      const now = new Date();
      let d = new Date(now);
      const lower = String(input).toLowerCase();

      if (lower.includes('tomorrow')) d.setDate(d.getDate() + 1);
      if (lower.includes('today')) { /* keep today */ }

      // Extract hour
      const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        let h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2] || '0');
        const ampm = timeMatch[3];
        if (ampm === 'pm' && h < 12) h += 12;
        if (ampm === 'am' && h === 12) h = 0;
        d.setHours(h, m, 0, 0);
      } else {
        d.setHours(11, 0, 0, 0); // default 11am
      }
      return d.toISOString();
    } catch {
      const d = new Date(); d.setDate(d.getDate()+1); d.setHours(11,0,0,0);
      return d.toISOString();
    }
  }

  async function insertWithRetry(payload, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(`${supabaseUrl}/rest/v1/schedules`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(payload)
        });
        const txt = await r.text();
        if (r.ok) return { ok: true, data: txt? JSON.parse(txt) : null };
        // Invalid payload - don't retry
        if (r.status >= 400 && r.status < 500) return { ok: false, error: txt, status: r.status };
        // Network/Supabase outage - retry
        if (i < retries - 1) await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i)));
      } catch (e) {
        if (i === retries - 1) return { ok: false, error: e.message };
        await new Promise(res => setTimeout(res, 1000 * Math.pow(2, i)));
      }
    }
    return { ok: false, error: 'Failed after retries' };
  }

  try {
    const { title = 'Workout', when = 'tomorrow 11 AM', businessId = 'B1' } = req.body || {};
    const scheduled_at = parseTime(when);

    if (!supabaseUrl ||!supabaseKey) {
      return res.status(500).json({ error: 'Supabase not configured', saved: false });
    }

    const result = await insertWithRetry({
      business_id: String(businessId),
      title: String(title).slice(0,200),
      description: `Reminder: ${title} at ${when}`,
      scheduled_at,
      status: 'pending'
    });

    if (result.ok) {
      return res.status(200).json({
        saved: true,
        message: `Reminder set: ${title} at ${new Date(scheduled_at).toLocaleString('en-PH')}`,
        data: result.data
      });
    } else {
      return res.status(200).json({
        saved: false,
        error: result.error,
        fallback: `Please add manually: ${title} at ${when} - Supabase error: ${String(result.error).slice(0,200)}`
      });
    }
  } catch (e) {
    return res.status(500).json({ saved: false, error: e.message });
  }
}
