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
    const supaUrl = (process.env.SUPABASE_URL || '').trim();
    const supaKey = (process.env.SUPABASE_ANON_KEY || '').trim();

    // Validate Supabase URL — prevent pattern error
    const isValidSupaUrl = supaUrl.startsWith('https://') && supaUrl.includes('.supabase.co') &&!supaUrl.includes('xxxxx');

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

    // Core identity — helpful, not spam
    const systemPrompt = `You are Clippy — Gelo's AI OS from Marilao, PH. Date: ${now}.
You have web search access. When user asks about current events, news, prices, weather, you MUST search web first.
Be helpful, concise, funny, buddy tone.
Only say "Good progress today buddy. Let's continue later." when user says goodbye/goodnight/wants to stop. Don't spam it.
If user asks how are you, answer normally: "I'm good bud! Back online with web access!"`;

    // Clean poisoned goodbye spam from history
    let cleanHistory = messages.filter(m => m.role!== 'system');
    // Remove consecutive goodbye spam, keep only last 2 if many
    const goodbyeCount = cleanHistory.filter(m => m.content?.includes('Good progress today buddy')).length;
    if (goodbyeCount > 2) {
      cleanHistory = cleanHistory.filter(m =>!m.content?.includes('Good progress today buddy'));
    }
    cleanHistory = cleanHistory.slice(-20);

    let webContext = '';
    // WEB SEARCH — only if needed
    const lastUserMsg = [...cleanHistory].reverse().find(m => m.role === 'user')?.content || '';
    const needsWeb = /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock/i.test(lastUserMsg);

    if (needsWeb && tavilyKey) {
      try {
        const searchRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: lastUserMsg, max_results: 5, search_depth: 'basic' })
        });
        const searchData = await searchRes.json();
        if (searchData.results?.length) {
          webContext = `\n\nWEB SEARCH RESULTS for "${lastUserMsg}":\n${searchData.results.map(r => `- ${r.title}: ${r.content.slice(0,300)} (${r.url})`).join('\n')}\nUse these results to answer!`;
        }
      } catch(e) { console.log('Tavily error', e.message); }
    }

    const finalMessages = [
      { role: 'system', content: systemPrompt + webContext },
     ...cleanHistory
    ];

    let response, data, reply = null;

    // 1. Try Groq with multiple models
    if (groqKey) {
      const models = ['llama-3.1-8b-instant', 'gemma2-9b-it', 'openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768'];
      for (const model of models) {
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
          });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) { reply = data.choices[0].message.content; break; }
        } catch {}
      }
    }

    // 2. Fallback OpenAI
    if (!reply && openaiKey) {
      try {
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
        });
        data = await response.json();
        if (response.ok) reply = data.choices?.[0]?.message?.content;
      } catch {}
    }

    if (!reply) {
      return res.status(200).json({ reply: `Error: No API key working. Groq: ${groqKey?'SET but all models failed: '+data?.error?.message:'NO'} OpenAI: ${openaiKey?'SET':'NO'} Tavily: ${tavilyKey?'SET':'NO'}` });
    }
// Optional: Log to Supabase securely if env set — FIXED pattern error
    const supaUrl = (process.env.SUPABASE_URL || '').trim();
    const supaKey = (process.env.SUPABASE_ANON_KEY || '').trim();
    const isValidSupaUrl = supaUrl.startsWith('https://') && supaUrl.includes('.supabase.co') && !supaUrl.includes('xxxxx');
    if (isValidSupaUrl && supaKey && messages.length) {
