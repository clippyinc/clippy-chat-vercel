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
    function needsLive(m) {
      if (!m) return false; const l=m.toLowerCase(); return ['today','now','current','latest','news','weather','lakers','nba','price','score','game','tomorrow','tonight','mayor','marilao','bulacan','crypto'].some(t=>l.includes(t));
    }
    let liveWebData='', liveSource='none';
    if (needsLive(userQuery) && tavilyKey) { liveWebData = await searchTavily(userQuery); liveSource='tavily'; }

    const coreIdentity = `
CLIPPY CORE IDENTITY - REMEMBER THIS FOREVER
Name: Clippy - Gelo's Personal AI OS
Location: Marilao, PH. User: Gelo Cabornay, Bonchon SM Valenzuela. Goal: Financial Freedom
Time: ${now}
Personality: Friendly, uses buddy, Taglish
Communication: Say "Good progress today buddy. Let's continue later." NEVER "tomorrow"!
Live: ${liveSource} ${liveWebData||'no search needed'}
You are Clippy.
`;

    const finalMessages = [{ role: 'system', content: coreIdentity },...messages.filter(m=>m.role!=='system').slice(-20)];

    let response, data;
    if (useGroq) {
      const groqModels = [
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'gemma2-9b-it'
      ];
      for (const m of groqModels) {
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` }, body: JSON.stringify({ model: m, messages: finalMessages, temperature: 0.7, max_tokens: 1500, tool_choice: 'none' }) });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) break;
          if (response.status===404||response.status===400) continue; else break;
        } catch { continue; }
      }
    } else {
      response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1500 }) });
      data = await response.json();
    }
    if (!response.ok) return res.status(200).json({ reply: `API error ${response.status}: ${data?.error?.message||JSON.stringify(data).slice(0,200)}` });
    const reply = data.choices?.[0]?.message?.content || 'No reply';

    // SUPABASE - only needs SUPABASE_URL + SUPABASE_ANON_KEY now (you deleted NEXT_PUBLIC, good!)
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;
    if (supaUrl && supaKey && supaUrl.includes('supabase.co') && supaKey.startsWith('eyJ')) {
      try {
        const supaRes = await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ content: lastUserMsg.content, role: 'user' })
        });
        console.log(`Supabase save: ${supaRes.status}`);
      } ca
