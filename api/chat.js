export default async function handler(req, res) {
  // ============================================================
  // CLIPPY CHAT API — V5 FINAL
  // Fixes: Token killer, Adaptive personality, table_registry, Make, Images
  // ============================================================

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method!== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. INPUT - V5: with mode + use_db
    const { messages, businessId = "B1", mode = "casual", use_db = false } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array" });

    const groqKey = (process.env.GROQ_API_KEY || "").trim();
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: "Buddy, wala pa akong AI API key. Add GROQ_API_KEY sa Vercel." });
    }

    // 2. CLEAN HISTORY - V5 FIX: 8 messages only, 500 chars each = 2k tokens!
    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({
      role: m.role,
      content: String(m.content || "").slice(0, 500)
    }));

    const lastUserMessage = [...cleanHistory].reverse().find(m => m.role === "user");
    const lastUserQ = lastUserMessage?.content?.trim() || "";
    if (!lastUserQ) return res.status(400).json({ error: "No user message" });

    const now = new Date();
    const localDateTime = now.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "long" });

    // 3. SUPABASE HELPERS
    function supabaseHeaders(json = false) {
      const h = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      if (json) { h["Content-Type"] = "application/json"; h["Prefer"] = "return=representation"; }
      return h;
    }
    async function supabaseRequest(method, table, query = "", body = null) {
      if (!supabaseUrl ||!supabaseKey) return { ok: false, data: null, error: "no supabase" };
      try {
        const r = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
          method, headers: supabaseHeaders(method!== "GET"),
          body: body? JSON.stringify(body) : undefined
        });
        const text = await r.text();
        let data = null; try { data = text? JSON.parse(text) : null; } catch { data = text; }
        return { ok: r.ok, status: r.status, data, error: r.ok? null : text };
      } catch (e) { return { ok: false, data: null, error: e.message }; }
    }
    const supabaseGet = (t, q) => supabaseRequest("GET", t, q);
    const supabaseInsert = (t, p) => supabaseRequest("POST", t, "", p);

    // 4. DATABASE CONTEXT - V5: ONLY IF use_db (hasClippy)
    let contextData = { tasks: "", schedules: "", memories: "", businessData: "", reminders: "", registry: "" };
    let rawData = { tasks: [], schedules: [], memories: [], businessData: [], reminders: [] };

    if (use_db && supabaseUrl && supabaseKey) {
      try {
        // NEW: table_registry - add tables without touching JS!
        const registryRes = await supabaseGet("table_registry", "?enabled=eq.true&select=table_name,description");
        let registryTables = [];
        if (registryRes.ok && Array.isArray(registryRes.data)) {
          registryTables = registryRes.data.map(r => r.table_name);
          contextData.registry = "\n\nAVAILABLE TABLES (via registry):\n" + registryTables.join(", ");
        }

        const [taskRes, scheduleRes, memoryRes, businessRes, reminderRes] = await Promise.all([
          supabaseGet("tasks", `?business_id=eq.${encodeURIComponent(businessId)}&is_done=eq.false&select=&order=created_at.desc&limit=20`),
          supabaseGet("schedules", `?business_id=eq.${encodeURIComponent(businessId)}&select=&order=scheduled_at.asc&limit=20`),
          supabaseGet("memories", `?business_id=eq.${encodeURIComponent(businessId)}&select=&order=created_at.desc&limit=20`),
          supabaseGet("business_data", `?select=&limit=30`),
          supabaseGet("clippy_reminders", `?is_read=eq.false&select=&order=created_at.desc&limit=5`) // NEW: Make reminders
        ]);

        if (taskRes.ok && taskRes.data?.length) {
          rawData.tasks = taskRes.data;
          contextData.tasks = "\n\nPENDING TASKS:\n" + rawData.tasks.map(t => `- ${t.title} | Due: ${t.due_at||'N/A'}`).join("\n");
        }
        if (scheduleRes.ok && scheduleRes.data?.length) {
          rawData.schedules = scheduleRes.data;
          contextData.schedules = "\n\nSCHEDULES:\n" + rawData.schedules.map(s => `- ${s.title} | ${s.scheduled_at}`).join("\n");
        }
        if (reminderRes.ok && reminderRes.data?.length) {
          rawData.reminders = reminderRes.data;
          contextData.reminders = "\n\n⚠️ UNUSUAL DETECTED BY MAKE (tell user!):\n" + rawData.reminders.map(r => `- ${r.message}`).join("\n");
        }
        if (memoryRes.ok && memoryRes.data?.length) {
          const qWords = lastUserQ.toLowerCase().split(/\s+/).filter(w=>w.length>=3);
          const scored = memoryRes.data.map(m=>{
            let score=0; const c=String(m.content||'').toLowerCase();
            qWords.forEach(w=>{ if(c.includes(w)) score+=2; });
            return {...m,_score:score};
          }).sort((a,b)=>b._score-a._score).slice(0,5);
          contextData.memories = "\n\nRELEVANT MEMORIES:\n" + scored.map(m=>`[${m.role}] ${m.content}`).join("\n");
        }
        if (businessRes.ok && businessRes.data?.length) {
          contextData.businessData = "\n\nBUSINESS DATA:\n" + businessRes.data.map(b=>`- ${JSON.stringify(b).slice(0,200)}`).join("\n");
        }

        // Auto-mark reminders as read after showing
        if (rawData.reminders.length) {
          for (const r of rawData.reminders) {
            await supabaseRequest("PATCH", "clippy_reminders", `?id=eq.${r.id}`, { is_read: true });
          }
        }
      } catch (e) { console.error("DB ERROR", e); }
    }

    // 5. WEB SEARCH - V5: with images!
    let webContext = "";
    const needsWeb = /weather|news|latest|current|today|price|search|who is|what is|nba|stock|usd|php|show|image|video/i.test(lastUserQ);
    let webImages = [];

    if (needsWeb && tavilyKey) {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: lastUserQ,max_results: 5,
            search_depth: "basic",
            include_answer: true,
            include_images: true // NEW: images!
          })
        });
        const data = await r.json();
        if (r.ok && data.results) {
          webContext = "\n\nWEB INFO:\n" + data.results.map(x=>`- ${x.title}: ${String(x.content||'').slice(0,400)}`).join("\n");
          if (data.images) webImages = data.images.slice(0,3); // top 3 images
        }
      } catch (e) { console.error("TAVILY", e); }
    }

    // 6. PERSONALITY - V5 ADAPTIVE (30% bud/boss, no robotic)
    const personalities = {
      casual: `
You are Clippy, barkada mode.
- Taglish chill, natural, short replies
- Call user bud/buddy ONLY 30% of time, occasionally, not every message
- You are NOT doing DB work right now, just kwentuhan
- Be human, funny sometimes, don't end every msg with question
- If web images available, show them as![desc](url)
`,
      work: `
You are Clippy, work mode.
- Professional but friendly, helpful
- Call user boss/bossing ONLY 30% when important, not every message
- You HAVE access to DB: tasks, schedules, business_data, reminders
- Main jobs: pull/push DB, file generation, file reader, file conversion to DB
- If Make detected unusual, tell user immediately (from reminders context)
- When web search, ALWAYS show images if available:![desc](url) and videos as [video](url)
- Keep replies concise, not essay
`
    };

    const systemPrompt = `
${personalities[mode] || personalities.casual}

CURRENT TIME: ${localDateTime}
Business ID: ${businessId}
Mode: ${mode} | use_db: ${use_db}

${use_db? `
DATABASE CONTEXT (only because user said "clippy"):
${contextData.reminders}
${contextData.tasks}
${contextData.schedules}
${contextData.memories}
${contextData.businessData}
${contextData.registry}

If reminders has unusual, tell user first!
` : "No DB context - casual chat only."}

WEB CONTEXT:
${webContext || "No web search"}
${webImages.length? "\nWEB IMAGES (show these!):\n" + webImages.map(url=>`![image](${url})`).join("\n") : ""}

RULES:
- Respond in JSON: {"reply": "your message with images as![desc](url) if any", "actions": []}
- Actions types: memory, task, schedule, business_data
- Only create action when user gives info worth storing
- Don't say "saved" - backend will handle
- Talk WITH Gelo, not AT him
- Don't overuse emojis, don't start with "Certainly"
- When you have web images, include at least 1-2 in reply as markdown!
`;

    // 7. AI REQUEST
    const finalMessages = [{ role: "system", content: systemPrompt },...cleanHistory];
    let aiResult = null; let lastErr = "";

    if (groqKey) {
      for (const model of [process.env.GROQ_MODEL||"llama-3.3-70b-versatile","llama-3.1-8b-instant"]) {
        try {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1000, response_format: { type: "json_object" } })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { aiResult = d.choices[0].message.content; break; }
          lastErr = d?.error?.message || `Groq ${r.status}`;
        } catch (e) { lastErr = e.message; }
      }
    }
    if (!aiResult && openaiKey) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: finalMessages, temperature: 0.7, max_tokens: 1000, response_format: { type: "json_object" } })
        });
        const d = await r.json();
        if (r.ok && d.choices?.[0]?.message?.content) aiResult = d.choices[0].message.content;
        else lastErr = d?.error?.message;
      } catch (e) { lastErr = e.message; }
    }

    if (!aiResult) return res.status(200).json({ reply: `Buddy, nag-fail AI: ${lastErr}. Check Vercel logs.` });

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult), actions: [] }; }
    let reply = (parsed.reply || "Yep bud.").trim();
    let actions = Array.isArray(parsed.actions)? parsed.actions : [];

    // 8. EXECUTE ACTIONS (only if use_db)
    if (use_db && supabaseUrl && supabaseKey && actions.length) {
      for (const a of actions) {
        if (!a?.type ||!a?.data) continue;
        if (a.type === "memory" && a.data.content) await supabaseInsert("memories", { business_id: businessId, content: String(a.data.content).slice(0,2000), role: "user" });
        if (a.type === "task" && a.data.title) await supabaseInsert("tasks", { business_id: businessId, title: String(a.data.title).slice(0,500), due_at: a.data.due_at||null, is_done: false });
        if (a.type === "schedule" && a.data.title && a.data.scheduled_at) await supabaseInsert("schedules", { business_id: businessId, title: String(a.data.title).slice(0,500), scheduled_at: a.data.scheduled_at, status: a.data.status||"pending" });
        if (a.type === "business_data" && a.data.name) {
          let res = await supabaseInsert("business_data", { business_id: businessId, name: String(a.data.name).slice(0,1000) });
          if (!res.ok && /business_id/i.test(res.error||"")) await supabaseInsert("business_data", { name: String(a.data.name).slice(0,1000) });
        }
      }
    }

    // Save chat messages only if work mode
    if (use_db && supabaseUrl && supabaseKey) {
      await supabaseInsert("messages", [
        { business_id: businessId, content: lastUserQ.slice(0,2000), role: "user" },
        { business_id: businessId, content: reply.slice(0,4000), role: "assistant" }
      ]);
    }

    reply = reply.replace(/[\s\S]*?/g, "").trim();

    return res.status(200).json({ reply, mode, use_db, images: webImages });

  } catch (e) {
    console.error("FATAL", e);
    return res.status(500).json({ reply: "Buddy, server error. Check Vercel logs.", error: e.message });
  }
}
