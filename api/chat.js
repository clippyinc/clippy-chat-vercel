export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, businessId = 'B1' } = req.body || {};
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || '').trim();
    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
    const supabaseKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: 'No key! Add GROQ_API_KEY' });
    }

    const cleanHistory = messages.filter(m => m.role!== 'system').slice(-20);
    const lastUserQ = cleanHistory.filter(m => m.role === 'user').slice(-1)[0]?.content || '';

    let contextData = { tasks: '', businessData: '', memories: '', schedule: '' };

    if (supabaseUrl && supabaseKey) {
      const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      try {
        const [taskRes, bizRes, memRes, schedRes] = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/tasks?business_id=eq.${businessId}&is_done=eq.false&select=title,due_at&order=created_at.desc&limit=5`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/business_data?select=id,name&limit=5`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/memories?business_id=eq.${businessId}&select=content,role&order=created_at.desc&limit=5`, { headers }),
          fetch(`${supabaseUrl}/rest/v1/schedules?business_id=eq.${businessId}&select=title,scheduled_at,status&order=scheduled_at.asc&limit=5`, { headers })
        ]);

        if (taskRes.ok) {
          const tasks = await taskRes.json();
          if (tasks?.length) contextData.tasks = '\n\nPENDING TASKS:\n' + tasks.map(t => `- ${t.title} (Due: ${t.due_at || 'N/A'})`).join('\n');
        }
        if (bizRes.ok) {
          const biz = await bizRes.json();
          if (biz?.length) contextData.businessData = '\n\nBUSINESS DATA:\n' + biz.map(b => `- ${b.id}: ${b.name}`).join('\n');
        }
        if (memRes.ok) {
          const mems = await memRes.json();
          if (mems?.length) contextData.memories = '\n\nRECENT MEMORIES:\n' + mems.reverse().map(m => `[${m.role}]: ${m.content}`).join('\n');
        }
        if (schedRes.ok) {
          const sched = await schedRes.json();
          if (sched?.length) contextData.schedule = '\n\nUPCOMING SCHEDULE:\n' + sched.map(s => `- ${s.title} at ${s.scheduled_at || 'No date'} (${s.status})`).join('\n');
        }
      } catch (e) { console.error('Supabase fetch fail:', e.message); }
    }

    let webContext = '';
    const needsWeb = /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock|nba|weather in/i.test(lastUserQ);
    if (needsWeb && tavilyKey) {
      try {
        const sRes = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: tavilyKey, query: lastUserQ, max_results: 5, search_depth: 'basic', include_answer: true })
        });
        const sData = await sRes.json();
        if (sData.results?.length) {
          webContext = `\n\nWEB SEARCH:\n${sData.results.map(r => `- ${r.title}: ${r.content.slice(0,350)}`).join('\n')}`;
        }
      } catch (e) {}
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    let systemPrompt = `You are Clippy — Gelo's AI OS from Marilao, PH. Date: ${now}. Be friendly, warm, direct. No markdown symbols. You have access to tasks, business_data, memories, schedules. ${contextData.tasks}${contextData.businessData}${contextData.schedule}${contextData.memories}${webContext}`;

    const finalMessages = [{ role: 'system', content: systemPrompt },...cleanHistory];
    let reply = null; let lastError = '';

    if (groqKey) {
      for (const model of ['llama-3.1-8b-instant','gemma2-9b-it','openai/gpt-oss-20b','llama-3.3-70b-versatile']) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
          las
