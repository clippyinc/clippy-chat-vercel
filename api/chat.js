export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: 'No key! Add GROQ_API_KEY in Vercel → Settings → Env Vars → Production checked → Redeploy' });
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    const systemPrompt = `You are Clippy — Gelo's AI OS from Marilao, PH. Date: ${now}.
Be helpful, concise, buddy tone. Answer normally.
Only say "Good progress today buddy. Let's continue later." when user says goodbye/goodnight. Don't spam it every message.`;

    const cleanHistory = messages.filter(m => m.role!== 'system').slice(-20);
    const finalMessages = [{ role: 'system', content: systemPrompt },...cleanHistory];

    let reply = null;
    let lastError = '';

    // 1. Try Groq (free)
    if (groqKey) {
      const models = ['llama-3.1-8b-instant', 'gemma2-9b-it', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
      for (const model of models) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
          lastError = d?.error?.message || `Groq ${r.status}`;
        } catch (e) { lastError = e.message; }
      }
    }

    // 2. Try OpenAI fallback
    if (!reply && openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
        });
        const d = await r.json();
        if (r.ok) reply = d.choices?.[0]?.message?.content;
        else lastError = d?.error?.message;
      } catch (e) { lastError = e.message; }
    }

    if (!reply) {
      return res.status(200).json({ reply: `Error: ${lastError || 'No reply'}` });
    }

    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(200).json({ reply: `Server error: ${e.message}` });
  }
}
