// Clippy V2 - Polished, token-saving
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, images = [] } = req.body || {};
    const geminiKey = (process.env.GEMINI_API_KEY || "").trim(); // 🟡 .trim() fixes space bug
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!Array.isArray(messages)) return res.status(200).json({ reply: "Messages must be array bud." });
    if (!geminiKey) return res.status(200).json({ reply: "Wala GEMINI_API_KEY bud! Vercel > Env Vars > AQ key > Production+Preview > Redeploy no cache." });

    // ================= LAYER 1: ZERO TOKEN FILTER =================
    function detectTask(text) {
      const t = (text || "").toLowerCase();
      if (t.includes(".csv") || t.includes("analyze") && t.includes("file")) 
        return { type: "csv", prompt: "Gusto mo bang analyze naten tong csv file boss? 📊" };
      if (t.includes("notes") || t.includes("supabase") || t.includes("database")) 
        return { type: "db", prompt: "Gusto mo bang i-check naten notes boss? 🗂️" };
      if (t.match(/look.*internet|search|web|presyo|news|balita/)) 
        return { type: "web", prompt: "Check ba naten sa web boss? 🌐" };
      return { type: "chat", prompt: null };
    }

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const task = detectTask(lastUser);
    const prevBot = [...messages].reverse().find(m => m.role === "assistant")?.content || "";
    const isYes = /^(yes|oo|sige|go|confirm|ok)$/i.test(lastUser.trim());
    const wasAsked = prevBot.includes("Gusto mo bang") || prevBot.includes("Check ba naten");

    // ================= LAYER 2: CONFIRM GATE =================
    if (task.prompt && !isYes && !wasAsked) {
      return res.status(200).json({ reply: `${task.prompt} Type "yes" para di masayang tokens!`, awaitingConfirm: true });
    }

    // ================= LAYER 3: KEYS ONLY IF CONFIRMED =================
    let extra = "";
    if (task.type === "web" && tavilyKey && (isYes || !task.prompt)) {
      try {
        const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: tavilyKey, query: lastUser, max_results: 3 }) });
        const d = await r.json();
        extra = `[WEB] ${d.results?.slice(0,3).map(x=>x.content?.slice(0,200)).join("\n")}`;
      } catch {}
    }

    // ================= LAYER 4: GEMINI (FIXED) =================
    const cleanHistory = messages.filter(m => m.role && m.role !== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) })); // 🔴 FIXED: -8 not -100!
    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    const systemPrompt = `You are Clippy barkada mode for Gelo, Taglish chill short. NO outline numbers. Time: ${now}. Extra: ${extra} Respond JSON: {"reply":"..."}`;

    let aiResult = null, lastErr = "";
    for (const model of ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-flash"]) { // 🟢 Alive models only!
      try {
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: '{"reply":"Gets"}' }] },
          ...cleanHistory.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
        ];
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: "application/json" } }) });
        const d = await r.json();
        if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) { aiResult = d.candidates[0].content.parts[0].text; break; }
        lastErr = d?.error?.message || `${model} ${r.status}`;
        if (r.status === 400 && lastErr.includes("not found")) continue;
        if (r.status === 400 || r.status === 403) break;
      } catch (e) { lastErr = e.message; }
    }

    if (!aiResult) return res.status(200).json({ reply: `Gemini error: ${lastErr}. Fix: new AQ key > Env Vars > Redeploy NO cache.` });
    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult).slice(0,2000) }; } // 🟢 Safe fallback iwas string error
    return res.status(200).json({ reply: (parsed.reply || "Yep bud.").trim() });
  } catch (e) { return res.status(200).json({ reply: `Server error: ${e.message}` }); }
}
