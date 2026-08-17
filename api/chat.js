export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body || {};
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;

    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    let reply = null;
    let debug = {};

    // TRY GROQ FIRST - this is your working key
    if (groqKey) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ 
            model: 'llama-3.1-8b-instant', 
            messages: messages.slice(-10),
            temperature: 0.7,
            max_tokens: 800
          })
        });
        const d = await r.json();
        debug.groq_status = r.status;
        debug.groq_response = d;
        if (r.ok && d.choices?.[0]?.message?.content) {
          reply = d.choices[0].message.content;
        } else {
          debug.groq_error = d.error || d;
        }
      } catch (e) {
        debug.groq_exception = e.message;
      }
    } else {
      debug.groq_missing = 'GROQ_API_KEY not set in Vercel env vars!';
    }

    // Fallback to OpenAI if Groq failed (you have zero tokens though)
    if (!reply && openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: messages.slice(-10), temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) reply = d.choices?.[0]?.message?.content;
        else debug.openai_error = d;
      } catch {}
    }

    if (!reply) {
      // Show debug info instead of fake free mode message
      reply = `Groq not working - Debug: ${JSON.stringify(debug).slice(0, 500)}. Make sure GROQ_API_KEY is added in Vercel Settings > Environment Variables and you clicked Redeploy!`;
    }

    if (supaUrl && supaKey) {
      try {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        await fetch(`${supaUrl}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' }, body: JSON.stringify({ content: lastUser, role: 'user' }) });
        await fetch(`${supaUrl}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' }, body: JSON.stringify({ content: reply, role: 'assistant' }) });
      } catch {}
    }

    return res.status(200).json({ reply, debug });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
