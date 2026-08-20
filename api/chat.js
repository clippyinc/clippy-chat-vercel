export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    const groqKey = process.env.GROQ_API_KEY;
    const tavilyKey = process.env.TAVILY_API_KEY;
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!groqKey &&!openaiKey) return res.status(500).json({ error: 'GROQ_API_KEY not set' });

    // 1. SUPABASE READ - memories B1
    let memContext = "";
    try {
      if (supaUrl && supaKey) {
        const r = await fetch(supaUrl + "/rest/v1/memories?business_id=eq.B1&order=created_at.desc&limit=5", {
          headers: { apikey: supaKey, Authorization: "Bearer " + supaKey }
        });
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
          const past = j.reverse().map(function(m){ return m.content; }).join(" | ").slice(0,800);
          memContext = " Past memories: " + past;
        }
      }
    } catch(e){}

    // 2. TAVILY SEARCH
    let tavilyContext = "";
    try {
      if (tavilyKey && messages.length) {
        const lastQ = messages[messages.length-1]?.content || "";
        if (lastQ.length > 5) {
          const tRes = await fetch("https://api.tavily.com/search", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query: lastQ, max_results: 3, include_answer: true })
          });
          const tData = await tRes.json();
          if (tData.answer) tavilyContext = " Web info: " + tData.answer.slice(0,1000);
          else if (tData.results) tavilyContext = " Web info: " + tData.results.map(function(r){ return r.content; }).join(" ").slice(0,1000);
        }
      }
    } catch(e){}

    const basePrompt = "You are Clippy from Marilao, friendly buddy. You ARE connected to Supabase memories table B1 and you have web search via Tavily. Remember past chats. Be short friendly.";
    const systemPrompt = basePrompt + memContext + tavilyContext;

    // 3. GROQ CALL
    let reply = null;
    let lastError = null;
    if (groqKey) {
      try {
        const gRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: "Bearer " + groqKey },
          body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'system', content: systemPrompt },...messages.slice(-10)],
            temperature: 0.7
          })
        });
        const gData = await gRes.json();
        if (gRes.ok) reply = gData.choices?.[0]?.message?.content;
        else lastError = JSON.stringify(gData).slice(0,500);
      } catch(e){ lastError = e.message; }
    }

    // Fallback OpenAI if Groq fails
    if (!reply && openaiKey) {
      const oRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: "Bearer " + openaiKey },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt },...messages.slice(-10)],
          temperature: 0.7
        })
      });
      const oData = await oRes.json();
      if (oRes.ok) reply = oData.choices?.[0]?.message?.content;
    }

    if (!reply) return res.status(500).json({ error: lastError || 'No reply from Groq/OpenAI' });

    // 4. SUPABASE SAVE to memories B1
    try {
      if (supaUrl && supaKey) {
        const lastUserMsg = [...messages].reverse().find(function(m){ return m.role === 'user'; });
        if (lastUserMsg) {
          fetch(supaUrl + "/rest/v1/memories", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: supaKey, Authorization: "Bearer " + supaKey, Prefer: 'return=minimal' },
            body: JSON.stringify({ business_id: 'B1', content: lastUserMsg.content.slice(0,1000), role: 'user' })
          }).catch(function(){});
        }
      }
    } catch(e){}

    return res.status(200).json({ reply });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
