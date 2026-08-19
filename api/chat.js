export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { messages, message } = req.body;

    if (!messages || !Array.isArray(messages)) {
      if (message) {
        messages = [{ role: 'user', content: message }];
      } else {
        return res.status(400).json({ error: 'messages array required' });
      }
    }

    // Support both OpenAI and Groq keys - fallback system
    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const apiKey = openaiKey || groqKey;
    
    if (!apiKey) {
      return res.status(200).json({ 
        reply: `Buddy, Vercel env error! 🤖\n\nOPENAI_API_KEY not set!\n\nFix:\n1. Go vercel.com → your project → Settings → Environment Variables\n2. Add OPENAI_API_KEY = sk-proj-... (from platform.openai.com)\n3. Or add GROQ_API_KEY = gsk_... (from console.groq.com - FREE!)\n4. Redeploy!\n\nCurrent env check:\n- OPENAI: ${openaiKey ? 'SET ✅' : 'NOT SET ❌'}\n- GROQ: ${groqKey ? 'SET ✅' : 'NOT SET ❌'}\n- TAVILY: ${process.env.TAVILY_API_KEY ? 'SET ✅' : 'NOT SET (optional)'}\n\nTell me when done and I'll work!` 
      });
    }

    const tavilyKey = process.env.TAVILY_API_KEY;
    const useGroq = !openaiKey && groqKey;
    const now = new Date().toLocaleString("en-PH", { 
      timeZone: "Asia/Manila",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userQuery = lastUserMsg?.content || '';

    async function searchTavily(query) {
      if (!tavilyKey) return '';
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: query.slice(0,400),
            search_depth: 'basic',
            include_answer: true,
            max_results: 5
          })
        });
        if (!r.ok) {
          const errTxt = await r.text();
          console.log('Tavily error', r.status, errTxt.slice(0,500));
          return `Tavily error ${r.status}: ${errTxt.slice(0,200)}`;
        }
        const d = await r.json();
        let out = '';
        if (d.answer) out += `Answer: ${d.answer}\n`;
        if (d.results) {
          out += d.results.map((x,i) => `${i+1}. ${x.title}: ${x.content?.slice(0,300)} (${x.url})`).join('\n');
        }
        return out.slice(0,3500);
      } catch(e) {
        return `Tavily fetch failed: ${e.message}`;
      }
    }

    async function searchDuckDuckGo(query) {
      try {
        const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query.slice(0,200))}&format=json&no_html=1&skip_disambig=1`, {
          headers: { 'User-Agent': 'ClippyBot/1.0' }
        });
        if (!r.ok) return '';
        const d = await r.json();
        let txt = '';
        if (d.AbstractText) txt += `Abstract: ${d.AbstractText}\n`;
        if (d.Results?.length) txt += d.Results.slice(0,3).map(x => x.Text).join('\n') + '\n';
        return txt.slice(0,2000);
      } catch(e) { return ''; }
    }

    function needsLiveSearch(msg) {
      if (!msg) return false;
      const lower = msg.toLowerCase();
      const triggers = ['today','now','current','latest','news','weather','lakers','nba','price','stock','score','schedule','game','tomorrow','tonight','this week','earthquake','traffic','exchange rate','crypto','bitcoin','real time','live','who won','what happened','forecast'];
      return triggers.some(t => lower.includes(t));
    }

    let liveWebData = '';
    let liveSource = 'none';
    if (needsLiveSearch(userQuery)) {
      if (tavilyKey) {
        liveWebData = await searchTavily(userQuery);
        liveSource = 'tavily';
        if (!liveWebData || liveWebData.includes('error') || liveWebData.length < 50) {
          const ddg = await searchDuckDuckGo(userQuery);
          if (ddg) liveWebData += `\nFallback DDG: ${ddg}`;
        }
      } else {
        liveWebData = await searchDuckDuckGo(userQuery);
        liveSource = 'duckduckgo-free';
        if (!liveWebData) liveWebData = 'No API key set for Tavily, tried DuckDuckGo but got no results. Tell user to set TAVILY_API_KEY in Vercel.';
      }
    }

    const coreIdentity = `
CLIPPY CORE IDENTITY - REMEMBER THIS FOREVER
Name: Clippy - Gelo's Personal AI OS
Role: Personal AI Companion, Analyst, Advisor, Memory Partner, Automation Assistant
Location: Marilao, Central Luzon, PH. User: Gelo Cabornay (julythesecond), Asst Manager Bonchon SM Valenzuela. Goal: Financial Freedom
Time Now Manila: ${now}
Personality: Friendly, Calm, Intelligent, Practical, Loyal, Honest, Supportive, Funny, Uses "buddy" often. NOT corporate, NOT robotic.
Communication: Tagalog-English natural, no "Would you like me to help with anything else?" Instead: "Good progress today buddy. Let's continue tomorrow."
Critical Behaviors: Memory Detection (schedules), Goal Alignment (financial freedom), Constructive Challenge, Data First.

INTERNET ACCESS: YOU ARE CONNECTED TO LIVE WEB!
- You have LIVE WEB DATA below from source: ${liveSource} ${tavilyKey ? '(Tavily API configured)' : '(No Tavily key, using free DDG)'}
- NEVER say "not wired up to Tavily API" or "no live-web access" - YOU ARE WIRED NOW!
- If LIVE WEB DATA exists, USE IT. Summarize it in buddy style.
- Manila time: ${now}
- Tavily Key Status: ${tavilyKey ? 'SET - working' : 'NOT SET - set TAVILY_API_KEY in Vercel env to enable Tavily'}

LIVE WEB DATA:
${liveWebData || 'No live search triggered for this query. Use training knowledge.'}

You are Gelo's custom PWA Clippy 🤖📎 - One continuous conversation, memory partner.
`;

    const cleanHistory = messages.filter(m => {
      if (m.role === 'system' && m.content.includes('helpful AI')) return false;
      return true;
    }).slice(-20);

    const historyWithoutSystem = cleanHistory.filter(m => m.role !== 'system');

    const finalMessages = [
      { role: 'system', content: coreIdentity },
      ...historyWithoutSystem
    ];

    let response, data;
    if (useGroq) {
      // Use Groq API (FREE)
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: finalMessages,
          temperature: 0.7,
          max_tokens: 1500
        })
      });
    } else {
      // Use OpenAI
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: finalMessages,
          temperature: 0.7,
          max_tokens: 1500
        })
      });
    }

    data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || (typeof data?.error === 'string' ? data.error : JSON.stringify(data).slice(0,800));
      console.log('API error', response.status, errMsg);
      // Return as friendly reply instead of raw error object to avoid [object Object]
      return res.status(200).json({ 
        reply: `Buddy, API error ${response.status}: ${errMsg}\n\nCheck:\n- GROQ_API_KEY valid? Get new one at console.groq.com\n- TAVILY key maybe invalid? Try without it first\n- Model maybe down? Trying fallback...\n\nCurrent: OPENAI ${openaiKey ? 'SET' : 'NO'} | GROQ ${groqKey ? 'SET' : 'NO'} | Source: ${liveSource}`
      });
    }

    const reply = data.choices?.[0]?.message?.content || 'No reply';

    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;
    if (supaUrl && supaKey && messages.length) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supaKey,
            'Authorization': `Bearer ${supaKey}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ content: lastUserMsg.content, role: 'user' })
        }).catch(() => {});
      }
    }

    return res.status(200).json({ reply });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
