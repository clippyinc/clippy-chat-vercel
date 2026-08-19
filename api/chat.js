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
    const tavilyKey = process.env.TAVILY_API_KEY;

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userQuery = lastUserMsg?.content || '';

    // Live search
    let liveWebData = '';
    if (userQuery.toLowerCase().match(/mayor|marilao|today|news|weather|price/) && tavilyKey) {
      try {
        const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: tavilyKey, query: userQuery.slice(0,400), search_depth: 'basic', include_answer: true, max_results: 3 }) });
        const d = await r.json();
        liveWebData = d.answer || '';
      } catch {}
    }

    const coreIdentity = `CLIPPY - Gelo's AI OS, Marilao PH, ${now}. Say "Good progress today buddy. Let's continue later." NEVER say tomorrow! Live: ${liveWebData}`;

    const finalMessages = [{ role: 'system', content: coreIdentity },...messages.filter(m=>m.role!=='system').slice(-20)];

    let response, data, usedModel = '';

    // Try OpenAI FIRST if you have it (more stable)
    if (openaiKey) {
      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
        });
        data = await response.json();
        if (response.ok && data.choices?.[0]?.message?.content) {
          usedModel = 'gpt-4o-mini';
        } else {
          throw new Error(data?.error?.message || 'OpenAI failed');
        }
      } catch(e) {
        console.log('OpenAI failed, trying Groq', e.message);
        response = null;
      }
    }

    // Fallback to Groq if OpenAI failed or not set
    if (!response ||!response.ok) {
      if (!groqKey) {
        return res.status(200).json({ reply: `Buddy, no API key! OpenAI failed and GROQ_API_KEY not set. Add GROQ_API_KEY at console.groq.com` });
      }
      const groqModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'openai/gpt-oss-20b',
        'gemma2-9b-it',
        'mixtral-8x7b-32768'
      ];
      for (const m of groqModels) {
        try {
          console.log(`Trying Groq ${m}`);
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model: m, messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
          });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) { usedModel = m; break; }
          console.log(`Groq ${m} failed ${response.status}: ${data?.error?.message?.slice(0,200)}`);
          if (response.status===404||response.status===400||response.status===401) continue;
          else break;
        } catch(e) { continue; }
      }
    }

    if (!response ||!response.ok) {
      const err = data?.error?.message || 'No model worked';
      return res.status(200).json({ reply: `Buddy, API error: ${err}\n\nFix: Go to console.groq.com → Create NEW API key (gsk_...) → Vercel Env Vars → Update GROQ_API_KEY → Redeploy\n\nTried models: llama-3.3-70b-versatile, llama-3.1-8b-instant, gpt-oss-20b\n\nOpenAI ${openaiKey?'SET':'NO'} Groq ${groqKey?'SET':'NO'}` });
    }

    const reply = data.choices?.[0]?.message?.content || 'No reply';
    console.log(`Success with ${usedModel}`);

    // Supabase logging (optional, won't break if fails)
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;
    if (supaUrl && supaKey && supaUrl.includes('supabase.co')) {
      try {
        await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST', headers: { 'Content-Type':'application/json','apikey':supaKey,'Authorization':`Bearer ${supaKey}`,'Prefer':'return=minimal' },
          body: JSON.string
