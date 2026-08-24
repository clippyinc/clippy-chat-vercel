export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method!== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, businessId = "B1", mode = "casual", use_db = false, images = [] } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be array" });

    const geminiKey = (process.env.GEMINI_API_KEY || "").trim(); // AQ... or AIzaSy... both ok!
    const groqKey = (process.env.GROQ_API_KEY || "").trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const supabaseKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!geminiKey &&!groqKey) {
      return res.status(200).json({
        reply: "1. Summary: No API key\n2. Fix: Add GEMINI_API_KEY (AQ... key mo) + GROQ_API_KEY sa Vercel > Settings > Env Vars\n3. Get key: aistudio.google.com/app/apikey"
      });
    }

    // TOKEN KILLER FIXED - 8 msgs x 500 chars only = 1900 tokens
    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) }));
    const lastUserQ = [...cleanHistory].reverse().find(m => m.role === "user")?.content?.trim() || "";
    if (!lastUserQ) return res.status(400).json({ error: "No user message" });

    const now = new Date();
    const localDateTime = now.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "long" });

    function supabaseHeaders(json = false) {
      const h = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      if (json) { h["Content-Type"] = "application/json"; h["Prefer"] = "return=representation"; }
      return h;
    }
    async function supabaseRequest(method, table, query = "", body = null) {
      if (!supabaseUrl ||!supabaseKey) return { ok: false, data: null };
      try {
        const r = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, { method, headers: supabaseHeaders(method!== "GET"), body: body? JSON.stringify(body) : undefined });
        const text = await r.text(); let data = null; try { data = text? JSON.parse(text) : null; } catch { data = text; }
        return { ok: r.ok, data };
      } catch { return { ok: false, data: null }; }
    }
    const supabaseGet = (t, q) => supabaseRequest("GET", t, q);
    const supabaseInsert = (t, p) => supabaseRequest("POST", t, "", p);

    let contextData = { tasks: "", schedules: "", memories: "", businessData: "", reminders: "" };
    if (use_db && supabaseUrl && supabaseKey) {
      try {
        const reminderMatch = lastUserQ.match(/remind me to (.+) (tomorrow|today|at \d+|on.+)/i);
        if (reminderMatch) {
          const title = reminderMatch[1].trim();
          await supabaseInsert("schedules", { business_id: businessId, title: title.slice(0, 500), scheduled_at: new Date(Date.now() + 86400000).toISOString(), status: "pending" });
          contextData.reminders = `\n\nNEW REMINDER SET: ${title}`;
        }
        const [taskRes, scheduleRes, memoryRes] = await Promise.all([
          supabaseGet("tasks", `?business_id=eq.${encodeURIComponent(businessId)}&is_done=eq.false&select=title,due_at&order=created_at.desc&limit=15`),
          supabaseGet("schedules", `?business_id=eq.${encodeURIComponent(businessId)}&select=title,scheduled_at,status&order=scheduled_at.asc&limit=15`),
          supabaseGet("memories", `?business_id=eq.${encodeURIComponent(businessId)}&select=content,role,created_at&order=created_at.desc&limit=60`)
        ]);
        if (taskRes.ok && taskRes.data?.length) contextData.tasks = "\n\nTASKS:\n" + taskRes.data.map(t => `- ${t.title} | ${t.due_at || 'N/A'}`).join("\n").slice(0, 600);
        if (scheduleRes.ok && scheduleRes.data?.length) contextData.schedules = "\n\nSCHEDULES:\n" + scheduleRes.data.map(s => `- ${s.title} | ${s.scheduled_at}`).join("\n").slice(0, 600);
        if (memoryRes.ok && memoryRes.data?.length) {
          const qWords = lastUserQ.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          const scored = memoryRes.data.map(m => { let score = 0; const c = String(m.content || '').toLowerCase(); qWords.forEach(w => { if (c.includes(w)) score += 2; }); return {...m, _score: score }; }).sort((a, b) => b._score - a._score).slice(0, 4);
          contextData.memories = "\n\nMEMORIES:\n" + scored.map(m => `[${m.role}] ${m.content}`).join("\n").slice(0, 600);
        }
      } catch (e) { console.error(e); }
    }

    let webContext = ""; let webImages = [];
    if (tavilyKey && /weather|news|latest|current|today|price|search|who is|what is|nba|score|stock|usd|php/i.test(lastUserQ)) {
      try {
        const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query: lastUserQ, max_results: 3, search_depth: "basic", include_images: true }) });
        const data = await r.json(); if (r.ok && data.results) { webContext = "\n\nWEB:\n" + data.results.map(x => `- ${x.title}: ${String(x.content || '').slice(0, 300)}`).join("\n").slice(0, 800); if (data.images) webImages = data.images.slice(0, 2); }
      } catch {}
    }

    const personalities = {
      casual: `You are Clippy, mirror of Gelo Cabornay - Valenzuela, 1pm shift, 13yrs with Happy, Happy's Place owner, dark #0a0a0a.
MANDATORY FORMAT - DETAILED OUTLINE + NUMBERS (400-600 tokens):
1. Quick Answer (1-2 lines direct)
2. Facts/Data:
   2.1 Actual numbers
   2.2 Target / Last Year if given
   2.3 Math: (last-actual)/last*100 = %
3. Context/Nuance
4. My Take (Taglish barkada, bud/buddy 30% only)
RULES: If file/image attached: extract numbers. If missing data: ASK clarifying question, don't hallucinate. Bullets > essay.`,
      work: `You are Clippy, work mode - store analyst for Happy's Place. Professional friendly.
FORMAT:
1. Summary: ADS, Target, % vs Target
2. Breakdown:
   2.1 Total: actual vs last year + formula
   2.2 In-Store / Delivery split if given
   2.3 Math: show calculation
3. Status + Next Action
Ask if missing actual ADS, don't guess. Boss/bossing 30% only when important.`
    };

    const systemPrompt = `${personalities[mode] || personalities.casual}
TIME: ${localDateTime}
Business: ${businessId} Mode:${mode} use_db:${use_db}
${use_db? `DB:\n${contextData.reminders}\n${contextData.tasks}\n${contextData.schedules}\n${contextData.memories}\n` : "No DB - casual"}
${webContext? `WEB:\n${webContext}` : ""}
${webImages.length? `\nIMAGES:\n${webImages.map(url => `![image](${url})`).join("\n")}` : ""}
Respond ONLY valid JSON: {"reply":"outline formatted reply with![desc](url) if images","actions":[]} Actions: memory/task/schedule only when worth storing.`;

    let aiResult = null, lastErr = "";

    // 1. PRIMARY: GEMINI AQ... (1M tokens + vision)
    if (geminiKey) {
      try {
        console.log("Trying Gemini primary AQ...");
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Gets bud! Outline + numbers + ask if unsure. Ready!" }] }
        ];
        for (const m of cleanHistory) {
          contents.push({ role: m.role === "assistant"? "model" : "user", parts: [{ text: m.content }] });
        }
        if (images.length > 0) {
          const last = contents[contents.length - 1];
          for (const img of images.slice(0, 3)) {
            if (img.dataUrl) {
              const b64 = img.dataUrl.split(',')[1];
              const mime = img.dataUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
              last.parts.push({ inlineData: { data: b64, mimeType: mime } });
            }
          }
        }
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature: 0.65, maxOutputTokens: 900, responseMimeType: "application/json" } })
        });
        const d = await r.json();
        if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiResult = d.candidates[0].content.parts[0].text;
          console.log("Gemini AQ success");
        } else {
          lastErr = d?.error?.message || `Gemini ${r.status}: ${JSON.stringify(d).slice(0, 300)}`;
          console.error("Gemini fail:", lastErr);
        }
      } catch (e) { lastErr = e.message; console.error("Gemini exception:", e); }
    }

    // 2. BACKUP: GROQ (2 working models only)
    if (!aiResult && groqKey) {
      console.log("Falling back to Groq backup");
      for (const model of ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]) {
        try {
          const finalMessages = [{ role: "system", content: systemPrompt },...cleanHistory];
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.65, max_tokens: 900, response_format: { type: "json_object" } })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { aiResult = d.choices[0].message.content; console.log("Groq backup success:", model); break; }
          lastErr = d?.error?.message || `Groq ${r.status}`;
        } catch (e) { lastErr = e.message; }
      }
    }

    if (!aiResult) return res.status(200).json({ reply: `1. Summary: AI failed\n2. Error: ${lastErr}\n3. Fix: Check Vercel env GEMINI_API_KEY (AQ...) + GROQ_API_KEY`, error: lastErr, images: webImages });

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult).slice(0, 2000), actions: [] }; }
    let reply = (parsed.reply || "Yep bud.").trim().replace(/```[\s\S]*?```/g, "").trim();
    let actions = Array.isArray(parsed.actions)? parsed.actions : [];

    if (use_db && supabaseUrl && supabaseKey && actions.length) {
      for (const a of actions) {
        if (!a?.type ||!a?.data) continue;
        try {
          if (a.type === "memory" && a.data.content) await supabaseInsert("memories", { business_id: businessId, content: String(a.data.content).slice(0, 800), role: "user" });
          if (a.type === "task" && a.data.title) await supabaseInsert("tasks", { business_id: businessId, title: String(a.data.title).slice(0, 400), due_at: a.data.due_at || null, is_done: false });
          if (a.type === "schedule" && a.data.title) await supabaseInsert("schedules", { business_id: businessId, title: String(a.data.title).slice(0, 400), scheduled_at: a.data.scheduled_at || new Date().toISOString(), status: "pending" });
        } catch {}
      }
    }
    if (use_db && supabaseUrl && supabaseKey) { try { await supabaseInsert("messages", [{ business_id: businessId, content: lastUserQ.slice(0, 800), role: "user" }, { business_id: businessId, content: reply.slice(0, 800), role: "assistant" }]); } catch {} }

    return res.status(200).json({ reply, mode, use_db, images: webImages, provider: geminiKey && aiResult? "gemini" : "groq" });
  } catch (e) {
    console.error("FATAL:", e);
    return res.status(500).json({ reply: `1. Server Error: ${e.message}\n2. Fix: Check Vercel Function Logs`, error: e.message });
  }
}
