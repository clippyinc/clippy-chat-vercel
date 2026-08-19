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
    const tavilyKey = (process.env.TAVILY_API_KEY || '').trim();

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: 'No key! Add GROQ_API_KEY' });
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    let systemPrompt = `You are Clippy — Gelo's AI OS from Marilao, PH. Date: ${now}.
Be helpful, concise, buddy tone. You have web search access when needed.
Only say "Good progress today buddy. Let's continue later." when user says bye/goodnight.`;

    const cleanHistory = messages.filter(m => m.role!== 'system').slice(-20);
    const lastUserQ = cleanHistory.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    // --- WEB SEARCH (only when needed) ---
    let webContext = '';
    const needsWeb = /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock|nba|weather in/i.test(lastUserQ);

    if (needsWeb && tavilyKey) {
      try {
        const sRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: lastUserQ,
            max_results: 5,
            search_depth: 'basic',
            include_answer: true
          })
        });
        const sData = await sRes.json();
        if (sData.results?.length) {
          webContext = `\n\nWEB SEARCH RESULTS for "${lastUserQ}":\n${sData.results.map(r => `- ${r.title}: ${r.content.slice(0,350)} [${r.url}]`).join('\n')}\nAnswer using these results, cite sources!`;
        }
      } catch (e) { console.log('Tavily fail', e.message); }
    }

    const finalMessages = [{ role: 'system', content: systemPrompt + webContext },...cleanHistory];

    let reply = null;
    let lastError = '';

    // 1. Groq
    if (groqKey) {
      const models = ['llama-3.1-8b-instant', 'gemma2-9b-it', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
      for (const model of models) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
          lastError = d?.error?.message;
        } catch (e) { lastError = e.message; }
      }
    }

    // 2. OpenAI fallback
    if (!reply && openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
        });
        const d = await r.json();
        if (r.ok) reply = d.choices?.[0]?.message?.content;
        else lastError = d?.error?.message;
      } catch (e) { lastError = e.message; }
    }

    if (!reply) return res.status(200).json({ reply: `Error: ${lastError}` });
    return res.status(200).json({ reply });

  } catch (e) {
    return res.status(200).json({ reply: `Server error: ${e.message}` });
  }
}
