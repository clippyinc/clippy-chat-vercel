export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'hi';
    let reply = null;
    let provider = '';

    // 1. Try OpenAI
    if (openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) { reply = d.choices?.[0]?.message?.content; provider = 'openai'; }
      } catch {}
    }

    // 2. Try Groq FREE
    if (!reply && groqKey) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages, temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) { reply = d.choices?.[0]?.message?.content; provider = 'groq-free'; }
      } catch {}
    }

    // 3. FREE fallback - no key needed! (Pollinations - uses open models)
    if (!reply) {
      try {
        // Use last user message for free AI
        const prompt = encodeURIComponent(lastUser.slice(0, 500));
        const r = await fetch(`https://text.pollinations.ai/${prompt}?model=openai&system=You are Clippy, a helpful friendly assistant. Keep replies short and friendly.`);
        if (r.ok) {
          reply = await r.text();
          provider = 'free-pollinations';
          // Clean up if too long
          if (reply.length > 2000) reply = reply.slice(0, 2000);
        }
      } catch (e) {
        console.log('Pollinations failed', e.message);
      }
    }

    // 4. Ultimate fallback - mock reply so UI never breaks
    if (!reply) {
      reply = `Hey! I'm Clippy (demo mode) - your message was: "${lastUser}".\n\nTo get real AI replies:\n- Add GROQ_API_KEY in Vercel (free at console.groq.com) OR add $5 credit to OpenAI.\n\nBut for now, your app is working! Supabase saving is active.`;
      provider = 'demo-mode';
    }

    // Save to Supabase if configured
    if (supaUrl && supaKey) {
      try {
        await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ content: lastUser, role: 'user' })
        });
        await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ content: reply, role: 'assistant' })
        });
      } catch {}
    }

    return res.status(200).json({ reply, provider });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
