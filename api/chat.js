export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const USE_SUPABASE = false; // OFF MUNA! Fix main chat first

  const clean = (k) => (k||'').toString().trim().replace(/[\r\n"'\s]/g,'').replace(/[^ -~]/g,'').slice(0,300);

  try {
    const { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKeyRaw = process.env.GROQ_API_KEY;
    const openaiKeyRaw = process.env.OPENAI_API_KEY;
    const tavilyKeyRaw = process.env.TAVILY_API_KEY;

    const groqKey = clean(groqKeyRaw);
    const openaiKey = clean(openaiKeyRaw);
    const tavilyKey = clean(tavilyKeyRaw);

    console.log('Keys length:', groqKey.length, openaiKey.length, tavilyKey.length);

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: `No key found! GROQ len=${groqKey.length} OPENAI len=${openaiKey.length}. Re-add in Vercel!` });
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    const systemPrompt = `You are Clippy from Marilao PH. Date ${now}. Plain text only, no ** ###. Buddy tone.`;

    const cleanHistory = messages.filter(m => m.role!== 'system').slice(-15).map(m => ({ role: m.role, content: (m.content||'').slice(0,2000) }));
    const lastUserQ = cleanHistory.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    let webContext = '';
    if (false && tavilyKey) { // OFF muna web search para di makagulo
      try {
        const sRes = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: lastUserQ, max_results: 2 })
        });
        const sData = await sRes.json();
        if (sData.results?.length) webContext = `\nWEB: ${sData.results[0].content.slice(0,300)}`;
      } catch(e){}
    }

    const finalMessages = [{ role: 'system', content: systemPrompt + webContext },...cleanHistory];
    let reply = null; let lastError = '';

    // ONLY Groq first - safe
    if (groqKey) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: finalMessages, temperature: 0.7, max_tokens: 500 })
        });
        const txt = await r.text();
        let d;
        try { d = JSON.parse(txt); } catch { d = { error: { message: txt.slice(0,500) } }; }
        if (r.ok && d.choices?.[0]?.message?.content) reply = d.choices[0].message.content;
        else lastError = `Groq ${r.status}: ${d?.error?.message || txt.slice(0,200)}`;
      } catch (e) { lastError = `Groq fetch fail: ${e.message}`; console.error(e); }
    }

    if (!reply && openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 500 })
        });
        const d = await r.json();
        if (r.ok) reply = d.choices?.[0]?.message?.content;
        else lastError = `OpenAI ${r.status}: ${d?.error?.message}`;
      } catch (e) { lastError = `OpenAI fail: ${e.message}`; }
    }

    if (!reply) return res.status(200).json({ reply: `Error: ${lastError} | GROQ len=${groqKey.length}` });

    reply = reply.replace(/\*\*/g,'').replace(/###/g,'').replace(/```/g,'');
    return res.status(200).json({ reply });

  } catch (e) {
    console.error('TOP ERROR', e);
    return res.status(200).json({ reply: `Server error TOP: ${e.message}` });
  }
}
