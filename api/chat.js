export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let { messages, message } = req.body;
    if (!messages ||!Array.isArray(messages)) {
      if (message) messages = [{ role: 'user', content: message }];
      else return res.status(400).json({ error: 'messages array required' });
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const apiKey = openaiKey || groqKey;
    if (!apiKey) return res.status(200).json({ reply: `Buddy, no API key! Add GROQ_API_KEY in Vercel` });
    const tavilyKey = process.env.TAVILY_API_KEY;
    const useGroq =!openaiKey && groqKey;
    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userQuery = lastUserMsg?.content || '';

    async function searchTavily(q) {
      if (!tavilyKey) return '';
      try {
        const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: tavilyKey, query: q.slice(0,400), search_depth: 'basic', include_answer: true, max_results: 5 }) });
        if (!r.ok) return ''; const d = await r.json();
        let out = ''; if (d.answer) out += `Answer: ${d.answer}\n`; if (d.results) out += d.results.map((x,i)=>`${i+1}. ${x.title}: ${x.content?.slice(0,300)}`).join('\n');
        return out.slice(0,3500);
      } catch { return ''; }
    }

    const coreIdentity = `
CLIPPY CORE IDENTITY
Name: Clippy - Gelo's Personal AI OS, Marilao PH
User: Gelo Cabornay, Bonchon SM Valenzuela, Goal: Financial Freedom
Time: ${now}
Personality: Friendly, buddy, Taglish
Communication: Say "Good progress today buddy. Let's continue later." NEVER "tomorrow"!
You have live web via ${tavilyKey?'Tavily':'DuckDuckGo'}.
Live Data: ${userQuery.toLowerCase().match(/mayor|today|news/)? await searchTavily(userQuery) : 'no search needed'}
You are Clippy with memory!
`;

    const finalMessages = [{ role: 'system', content: coreIdentity },...messages.filter(m=>m.role!=='system').slice(-20)];

    let response, data;
    if (useGroq) {
      // ONLY WORKING MODELS AS OF JUNE 2026!
      const groqModels = [
        'llama-3.1-8b-instant', // MOST STABLE ✅
        'llama-3.3-70b-versatile', // NEW replacement for 3.1-70b ✅
        'openai/gpt-oss-20b', // Your old working model ✅
        'openai/gpt-oss-120b',
        'gemma2-9b-it',
        'mixtral-8x7b-32768'
      ];
      for (const m of groqModels) {
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model: m, messages: finalMessages, temperature: 0.7, max_tokens: 1500, tool_choice: 'none' })
          });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) break;
          if (response.status===404||response.status===400) continue; else break;
        } catch { continue; }
      }
    } else {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1500 })
      });
      data = await response.json();
    }

    if (!response.ok) {
      const err = data?.error?.message || JSON.stringify(data).slice(0,500);
      return res.status(200).json({ reply: `Buddy API error ${response.status}: ${err}` });
    }

    const reply = data.choices?.[0]?.message?.content || 'No reply';

    // SUPABASE - supports all 8 keys from your screenshot
    let finalUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    let finalKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABAS__OLE_KEY;
    if (!finalUrl) {
      for (const [k,v] of Object.entries(process.env)) {
        if (k.toLowerCase().includes('supabase') && k.toLowerCase().includes('url') && v?.includes('supabase.co')) { finalUrl=v; break; }
      }
    }
    if (!finalKey) {
      for (const [k,v] of Object.entries(process.env)) {
        if (k.toLowerCase().includes('supabase') && v?.startsWith('eyJ')) { finalKey=v; break; }
      }
    }
    if (finalUrl && finalKey) {
