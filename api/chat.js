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
      return res.status(200).json({ reply: "1. Summary: No API key\n2. Fix: Add GEMINI_API_KEY (AQ...) + GROQ_API_KEY sa Vercel > Settings > Env Vars" });
    }

    // TOKEN SAFE - 8 msgs x 500 chars
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

    let contextData = { tasks: "", schedules: "", memories: "", businessData: "" };
    if (use_db && supabaseUrl && supabaseKey) {
      try {
        const [taskRes, scheduleRes, memoryRes] = await Promise.all([
          supabaseGet("tasks", `?business_id=eq.${encodeURIComponent(businessId)}&is_done=eq.false&select=title,due_at&limit=15`),
          supabaseGet("schedules", `?business_id=eq.${encodeURIComponent(businessId)}&select=title,scheduled_at&limit=15`),
          supabaseGet("memories", `?business_id=eq.${encodeURIComponent(businessId)}&select=content,role&order=created_at.desc&limit=60`)
        ]);
        if (taskRes.ok && taskRes.data?.length) contextData.tasks = "\nTASKS:\n" + taskRes.data.map(t => `- ${t.title}`).join("\n").slice(0, 500);
        if (scheduleRes.ok && scheduleRes.data?.length) contextData.schedules = "\nSCHEDULES:\n" + scheduleRes.data.map(s => `- ${s.title}`).join("\n").slice(0, 500);
        if (memoryRes.ok && memoryRes.data?.length) {
          const qWords = lastUserQ.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          const scored = memoryRes.data.map(m => { let s = 0; const c = String(m.content || '').toLowerCase(); qWords.forEach(w => { if (c.includes(w)) s += 2; }); return {...m, _score: s }; }).sort((a, b) => b._score - a._score).slice(0, 4);
          contextData.memories = "\nMEMORIES:\n" + scored.map(m => `[${m.role}] ${m.content}`).join("\n").slice(0, 500);
        }
      } catch {}
    }

    let webContext = ""; let webImages = [];
    if (tavilyKey && /weather|news|latest|today|price|search|who is|what is|nba|score|stock/i.test(lastUserQ)) {
      try {
        const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query: lastUserQ, max_results: 3, search_depth: "basic", include_images: true }) });
        const data = await r.json(); if (r.ok && data.results) { webContext = "\nWEB:\n" + data.results.map(x => `- ${x.title}: ${String(x.content || '').slice(0, 300)}`).join("\n").slice(0, 700); if (data.images) webImages = data.images.slice(0, 2); }
      } catch {}
    }

    const personalities = {
      casual: `You are Clippy, mirror of Gelo Cabornay - Valenzuela, 1pm shift, Happy's Place owner.
MANDATORY FORMAT:
1. Quick Answer
2. Facts/Data: 2.1 Actual, 2.2 Target/Last Year, 2.3 Math: (last-actual)/last*100 = %
3. Context
4. My Take (Taglish barkada, bud/buddy 30% only)
RULES: If file/image attached: extract numbers. If missing: ASK, don't hallucinate.`,
      work: `You are Clippy, work mode - store analyst.
1. Summary: ADS, Target, %
2. Breakdown: 2.1 Total, 2.2 In-Store/Delivery, 2.3 Formula
3. Status + Next Action`
    };

    const systemPrompt = `${personalities[mode] || personalities.casual}
TIME: ${localDateTime} | Business: ${businessId} Mode:${mode}
${use_db? `DB:${contextData.tasks}${contextData.schedules}${contextData.memories}` : "No DB"}
${webContext}
${webImages.length? `\nIMAGES:\n${webImages.map(u => `![image](${u})`).join("\n")}` : ""}
Respond JSON ONLY: {"reply":"outline reply","actions":[]}`;

    let aiResult = null, lastErr = "";

    // 1. PRIMARY: GEMINI AQ... (1M tokens + vision) - SUPPORTS AQ... format!
    if (geminiKey) {
      try {
        console.log("Trying Gemini AQ primary...");
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Gets bud! Outline + numbers ready!" }] }
        ];
        for (const m of cleanHistory) contents.push({ role: m.role === "assistant"? "model" : "user", parts: [{ text: m.content }] });
        if (images.length) {
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
          console.log("Gemini AQ success!");
        } else {
          lastErr = d?.error?.message || `Gemini ${r.status}: ${JSON.stringify(d).slice(0, 300)}`;
          console.error("Gemini fail:", lastErr);
        }
      } catch (e) { lastErr = e.message; }
    }

    // 2. BACKUP: GROQ - ONLY WORKING MODELS (FIXED!)
    if (!aiResult && groqKey) {
      console.log("Falling back to Groq backup - working models only");
      const workingModels = [
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-20b"
      ];
      for (const model of workingModels) {
        try {
          console.log("Trying Groq:", model);
          const finalMessages = [{ role: "system", content: systemPrompt },...cleanHistory];
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.65, max_tokens: 900, response_format: { type: "json_object" } })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) {
            aiResult = d.choices[0].message.content;
            console.log("Groq backup success:", model);
            break;
          }
          lastErr = d?.error?.message || `Groq ${r.status}: ${JSON.stringify(d).slice(0, 300)}`;
          console.error("Groq fail:", model, lastErr);
        } catch (e) { lastErr = e.message; }
      }
    }

    if (!aiResult) return res.status(200).json({ reply: `1. Summary: AI failed\n2. Error: ${lastErr}\n3. Fix: Check Vercel env GEMINI_API_KEY (AQ...) + GROQ_API_KEY - make sure AQ key valid and Groq key has credits`, error: lastErr, images: webImages });

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

    return res.status(200).json({ reply, mode, use_db, images: webImages, provider: geminiKey && aiResult? "gemini" : "groq" });
  } catch (e) {
    console.error("FATAL:", e);
    return res.status(500).json({ reply: `1. Server Error: ${e.message}\n2. Fix: Check Vercel Function Logs`, error: e.message });
  }
}
