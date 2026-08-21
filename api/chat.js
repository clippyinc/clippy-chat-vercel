export default async function handler(req, res) {
  // Guarantee JSON headers to prevent parsing errors on the client
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, businessId = 'B1' } = req.body || {};
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || '').trim();
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!groqKey && !openaiKey) {
      return res.status(200).json({ reply: 'No key! Add GROQ_API_KEY' });
    }

    const cleanHistory = messages.filter(m => m.role !== 'system').slice(-20);
    const lastUserQ = cleanHistory.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    // --- PARALLEL SUPABASE RETRIEVAL FOR ALL TABLES ---
    let contextData = {
      tasks: '',
      businessData: '',
      memories: '',
      schedule: ''
    };

    if (supabaseUrl && supabaseKey) {
      const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      
      try {
        const [taskRes, bizRes, memRes, schedRes] = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/task?business_id=eq.${businessId}&status=eq.pending&select=task_name,due_date&order=created_at.desc&limit=5`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/business_data?business_id=eq.${businessId}&select=key,value&limit=10`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/memories?business_id=eq.${businessId}&select=content,role&order=created_at.desc&limit=5`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/schedule?business_id=eq.${businessId}&select=title,event_time&order=event_time.asc&limit=5`, { headers })
        ]);

        if (taskRes.ok) {
          const tasks = await taskRes.json();
          if (tasks?.length) contextData.tasks = '\n\nPENDING TASKS:\n' + tasks.map(t => `- ${t.task_name} (Due: ${t.due_date || 'N/A'})`).join('\n');
        }

        if (bizRes.ok) {
          const biz = await bizRes.json();
          if (biz?.length) contextData.businessData = '\n\nBUSINESS DATA:\n' + biz.map(b => `- ${b.key}: ${b.value}`).join('\n');
        }

        if (memRes.ok) {
          const mems = await memRes.json();
          if (mems?.length) contextData.memories = '\n\nRECENT MEMORIES:\n' + mems.reverse().map(m => `[${m.role}]: ${m.content}`).join('\n');
        }

        if (schedRes.ok) {
          const sched = await schedRes.json();
          if (sched?.length) contextData.schedule = '\n\nUPCOMING SCHEDULE:\n' + sched.map(s => `- ${s.title} at ${s.event_time}`).join('\n');
        }
      } catch (e) {
        console.error('Supabase multi-table fetch fail:', e.message);
      }
    }

    // --- WEB SEARCH ---
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
      } catch (e) { console.error('Tavily fail:', e.message); }
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    // Combine system prompt with all database tables
    let systemPrompt = `You are Clippy — Gelo's lively, high-energy AI OS from Marilao, PH. Date: ${now}.
Personality: Be friendly, warm, expressive, and direct. Use plain text and emojis (🚀, 🔥, ⚡).
FORMATTING RULE: Do NOT use markdown symbols like asterisks (**bold**), hash tags (# headings), or bullet symbols. Keep text completely clean and readable.
SYSTEM STATUS: You are connected to Supabase PostgreSQL with access to the user's task, business_data, messages, memories, and schedule tables. Use this data actively when replying!
Only say "Good progress today buddy. Let's continue later." when user says bye/goodnight.
${contextData.tasks}${contextData.businessData}${contextData.schedule}${contextData.memories}${webContext}`;

    const finalMessages = [{ role: 'system', content: systemPrompt }, ...cleanHistory];

    let reply = null;
    let lastError = '';

    // 1. Groq Fallback Loop
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

    // 2. OpenAI Fallback
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

    // Strip remaining markdown formatting symbols
    reply = reply.replace(/[\*#_`]/g, '');

    // --- SUPABASE WRITE LOGS (Messages & Memories) ---
    if (supabaseUrl && supabaseKey) {
      const headers = {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      };

      // 1. Log chat history to 'messages' table
      fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify([
          { business_id: businessId, content: lastUserQ.slice(0, 1000), role: 'user' },
          { business_id: businessId, content: reply.slice(0, 1000), role: 'assistant' }
        ])
      }).catch(e => console.error('Messages write fail:', e.message));

      // 2. Log persistent memory summary to 'memories' table
      fetch(`${supabaseUrl}/rest/v1/memories`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          business_id: businessId,
          content: `User asked: "${lastUserQ.slice(0, 200)}" | Bot replied: "${reply.slice(0, 200)}"`,
          role: 'system'
        })
      }).catch(e => console.error('Memories write fail:', e.message));
    }

    return res.status(200).json({ reply });

  } catch (e) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ reply: `Server error: ${e.message}` });
  }
}
