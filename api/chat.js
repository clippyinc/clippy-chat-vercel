export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method!== "POST") return res.status(405).json({ error: "Method not allowed" });

  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  const groqKey = (process.env.GROQ_API_KEY || "").trim();
  const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const supabaseKey = (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  // Dynamic Error Diagnosis - polished
  async function diagnoseError(rawError) {
    const errorStr = typeof rawError === "string"? rawError : (rawError?.message || JSON.stringify(rawError).slice(0, 500));
    const diagPrompt = `You are Clippy. Internal error: "${errorStr}" Explain in Taglish 2-3 sentences, how to fix (API key, rate limit, DB). NO numbered outlines (bawal 1. 2.). JSON: {"reply":"explanation"}`;
    if (geminiKey) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: diagPrompt }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 300 } })
        });
        const d = await r.json();
        if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) {
          const parsed = JSON.parse(d.candidates[0].content.parts[0].text);
          return parsed.reply;
        }
      } catch {}
    }
    // Fallback diagnosis without AI
    if (errorStr.includes("Rate limit") || errorStr.includes("TPD")) return `Buddy, naubos mo na yung Groq limit (200k tokens/day). Wait 7 mins or upgrade sa console.groq.com. Use Gemini AQ key primary para di maubos.`;
    if (errorStr.includes("API_KEY_INVALID") || errorStr.includes("API key")) return `Mukhang invalid yung GEMINI_API_KEY mo sa Vercel. Check mo may space ba? Get new key sa aistudio.google.com`;
    if (errorStr.includes("does not exist")) return `Dead model na yung tinatawag. Update mo api/chat.js sa working model: llama-3.3-70b-versatile`;
    return `Buddy, error: ${errorStr.slice(0, 300)}. Check Vercel > Logs.`;
  }

  try {
    const { messages, businessId = "B1", mode = "casual", use_db = false, images = [] } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: "messages must be an array" });
    if (!geminiKey &&!groqKey) return res.status(200).json({ reply: "Kulang setup bud: Lagay mo GEMINI_API_KEY (AQ...) sa Vercel Env Vars. Free 1M tokens yun!" });

    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) }));
    const lastUserQ = [...cleanHistory].reverse().find(m => m.role === "user")?.content?.trim() || "";
    if (!lastUserQ) return res.status(400).json({ error: "No user message found" });

    const localDateTime = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "long" });

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
    let contextData = { tasks: "", schedules: "", memories: "" };
    if (use_db && supabaseUrl && supabaseKey) {
      try {
        const [taskRes, scheduleRes, memoryRes] = await Promise.all([
          supabaseGet("tasks", `?business_id=eq.${encodeURIComponent(businessId)}&is_done=eq.false&select=title&limit=10`),
          supabaseGet("schedules", `?business_id=eq.${encodeURIComponent(businessId)}&select=title,scheduled_at&limit=10`),
          supabaseGet("memories", `?business_id=eq.${encodeURIComponent(businessId)}&select=content,role&order=created_at.desc&limit=40`)
        ]);
        if (taskRes.ok && taskRes.data?.length) contextData.tasks = "\nTASKS:\n" + taskRes.data.map(t => `- ${t.title}`).join("\n").slice(0, 400);
        if (scheduleRes.ok && scheduleRes.data?.length) contextData.schedules = "\nSCHEDULES:\n" + scheduleRes.data.map(s => `- ${s.title}`).join("\n").slice(0, 400);
        if (memoryRes.ok && memoryRes.data?.length) {
          const qWords = lastUserQ.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          const scored = memoryRes.data.map(m => { let s = 0; const c = String(m.content || '').toLowerCase(); qWords.forEach(w => { if (c.includes(w)) s += 2; }); return {...m, _score: s }; }).sort((a, b) => b._score - a._score).slice(0, 3);
          contextData.memories = "\nMEMORIES:\n" + scored.map(m => `[${m.role}] ${m.content}`).join("\n").slice(0, 400);
        }
      } catch {}
    }

    let webContext = "", webImages = [];
    if (tavilyKey && /news|weather|latest|today|price|who is|what is|nba|score|stock|usd|php|Moscow|Ukraine/i.test(lastUserQ)) {
      try {
        const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query: lastUserQ, max_results: 4, search_depth: "basic", include_images: true }) });
        const data = await r.json();
        if (r.ok && data.results) {
          webContext = "\nWEB RESULTS:\n" + data.results.map(x => `- ${x.title}: ${String(x.content || '').slice(0, 350)}`).join("\n").slice(0, 1000);
          if (Array.isArray(data.images)) webImages = data.images.slice(0, 2);
        }
      } catch {}
    }

    const isNumbersQuery = /ads|sales|\d{2,}|target|last year|%\s*vs|growth|down|up/i.test(lastUserQ) || images.length > 0;
    const personalities = {
      casual: `You are Clippy, barkada mode for Gelo. Valenzuela, 1pm shift, 13yrs with Happy.
STYLE: Taglish chill, short, conversational. Call bud/buddy ONLY 30% occasionally.
RULES: STRICTLY NO outline numbers or structured numerical lists (BAWAL 1., 1.1, 2.1). Use natural paragraphs or simple bullets. If news, 3-4 short bullets casual. Don't hallucinate N/A.`,
      work: `You are Clippy, work mode - store analyst for Happy's Place. Professional, friendly Taglish.
RULES: STRICTLY NO outline numbers (BAWAL 1., 1.1, 2.1). Explain facts, numbers, math in natural paragraphs or bullets. Call boss/bossing ONLY 30% occasionally. If no numbers, ask directly.`
    };
    const chosenPersonality = isNumbersQuery? personalities.work : personalities.casual;
    const systemPrompt = `${chosenPersonality}
TIME: ${localDateTime} | Business: ${businessId} | Query: ${isNumbersQuery? 'NUMBERS' : 'CASUAL'}
${use_db? `DB:\n${contextData.tasks}${contextData.schedules}${contextData.memories}` : ""}
${webContext}
${webImages.length? `\nIMAGES:\n${webImages.map(u => `![image](${u})`).join("\n")}` : ""}
Respond JSON ONLY: {"reply":"your reply in chosen style","actions":[]}`;

    let aiResult = null, lastErr = "";

    // 1. GEMINI PRIMARY - with fallback models
    if (geminiKey) {
      for (const model of ["gemini-1.5-flash", "gemini-1.5-flash-8b"]) {
        try {
          const contents = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Gets, natural Taglish, NO outline numbers." }] }
          ];
          for (const m of cleanHistory) contents.push({ role: m.role === "assistant"? "model" : "user", parts: [{ text: m.content }] });
          if (Array.isArray(images) && images.length) {
            const lastMsg = contents[contents.length - 1];
            for (const img of images.slice(0, 3)) {
              if (img?.dataUrl && typeof img.dataUrl === 'string') {
                const parts = img.dataUrl.split(',');
                if (parts.length === 2) {
                  const mime = img.dataUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
                  lastMsg.parts.push({ inlineData: { data: parts[1], mimeType: mime } });
                }
              }
            }
          }
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 900, responseMimeType: "application/json" } })
          });
          const d = await r.json();
          if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) { aiResult = d.candidates[0].content.parts[0].text; break; }
          lastErr = d?.error?.message || `Gemini ${model} ${r.status}`;
          if (r.status === 400 || r.status === 403) break; // invalid key, stop retry
        } catch (e) { lastErr = e?.message || String(e); }
      }
    }

    // 2. GROQ FALLBACK - FIXED: only working model, rate limit aware
    if (!aiResult && groqKey) {
      // ONLY working model - 500k TPD vs 200k of gpt-oss-20b
      for (const model of ["llama-3.3-70b-versatile"]) {
        try {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: [{ role: "system", content: systemPrompt },...cleanHistory], temperature: 0.7, max_tokens: 900, response_format: { type: "json_object" } })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { aiResult = d.choices[0].message.content; break; }
          lastErr = d?.error?.message || `Groq ${model} ${r.status}`;
          if (lastErr.includes("Rate limit") || lastErr.includes("TPD")) break; // same quota, don't retry
        } catch (e) { lastErr = e?.message || String(e); }
      }
    }

    if (!aiResult) {
      const diagnosis = await diagnoseError(lastErr);
      return res.status(200).json({ reply: diagnosis, error: lastErr });
    }

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult || "").slice(0, 2000), actions: [] }; }
    let reply = (parsed.reply || "Yep bud.").trim().replace(/```[\s\S]*?```/g, "").trim();

    return res.status(200).json({ reply, images: webImages, provider: geminiKey && aiResult? "gemini" : "groq", isNumbers: isNumbersQuery });
  } catch (e) {
    const errText = typeof e === "string"? e : (e?.message || JSON.stringify(e));
    console.error("FATAL:", errText);
    const diagnosis = await diagnoseError(errText);
    return res.status(500).json({ reply: diagnosis, error: errText });
  }
}
