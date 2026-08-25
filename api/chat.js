export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method!== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, images = [] } = req.body || {};
    const geminiKey = (process.env.GEMINI_API_KEY || "").trim();

    if (!Array.isArray(messages)) return res.status(200).json({ reply: "Messages must be array bud." });
    if (!geminiKey) return res.status(200).json({ reply: "Wala GEMINI_API_KEY bud! Vercel > Settings > Env Vars > Add AQ key > Production+Preview > Redeploy NO CACHE." });

    // 🟢 FIXED: slice(-8) not -100! + 500 chars not 4000
    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) }));
    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });

    // LAYER 1: ZERO TOKEN FILTER (yung verification na gusto mo)
    function detectTask(t) {
      const s = (t || "").toLowerCase();
      if (s.match(/\.csv|csv file|analyze.*file/)) return "Gusto mo bang analyze naten tong csv file boss? 📊 Type yes";
      if (s.match(/notes|supabase|database|history/)) return "Gusto mo bang i-check naten notes boss? 🗂️ Type yes";
      if (s.match(/web|internet|search|google|presyo|balita/)) return "Check ba naten sa web boss? 🌐 Type yes";
      return null;
    }
    const lastUser = cleanHistory.filter(m => m.role === "user").slice(-1)[0]?.content || "";
    const isYes = /^(yes|oo|sige|go|confirm|ok)$/i.test(lastUser.trim());
    const prevBot = [...messages].reverse().find(m => m.role === "assistant")?.content || "";

    const taskPrompt = detectTask(lastUser);
    if (taskPrompt &&!isYes &&!prevBot.includes("Gusto mo bang") &&!prevBot.includes("Check ba naten")) {
      return res.status(200).json({ reply: `${taskPrompt} para di masayang tokens!` });
    }

    const systemPrompt = `You are Clippy barkada mode for Gelo, Taglish chill short. NO outline numbers (bawal 1., 2.1). Call bud/buddy 30% only. Time: ${now} Respond JSON: {"reply":"reply"}`;

    let aiResult = null, lastErr = "";

    // 🟢 FIXED 2026 MODELS - v1beta alive list!
    const MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-001", "gemini-2.5-flash-lite"];

    for (const model of MODELS) {
      try {
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: '{"reply":"Gets, no outline."}' }] }
        ];
        for (const m of cleanHistory) contents.push({ role: m.role === "assistant"? "model" : "user", parts: [{ text: m.content }] });
        if (images.length) {
          const last = contents[contents.length-1];
          for (const img of images.slice(0,2)) {
            if (img?.dataUrl) {
              const b64 = img.dataUrl.split(',')[1];
              const mime = img.dataUrl.match(/data:(.*?);/)?.[1] || 'image/jpeg';
              if (b64) last.parts.push({ inlineData: { data: b64, mimeType: mime } });
            }
          }
        }
        // Try v1beta first, then v1 fallback
        for (const ver of ["v1beta", "v1"]) {
          const r = await fetch(`https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${geminiKey}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: "application/json" } })
          });
          const d = await r.json();
          if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) { aiResult = d.candidates[0].content.parts[0].text; console.log(`Gemini ${model} ${ver} OK`); break; }
          lastErr = d?.error?.message || `Gemini ${model} ${r.status}: ${JSON.stringify(d).slice(0,400)}`;
          if (lastErr.includes("not found")) continue;
          if (r.status === 400 || r.status === 403) break;
        }
        if (aiResult) break;
      } catch (e) { lastErr = e.message; }
    }

    if (!aiResult) {
      return res.status(200).json({ reply: `Gemini error bud: ${lastErr}. Fix: 1) aistudio.google.com > Get API key > New AQ key 2) Vercel Env Vars > GEMINI_API_KEY paste (no space) > Production+Preview > 3) Redeploy NO CACHE.` });
    }

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult).slice(0, 2000) }; }
    return res.status(200).json({ reply: (parsed.reply || "Yep bud.").trim() });
  } catch (e) {
    return res.status(200).json({ reply: `Server error: ${e.message}`, error: e.message });
  }
}
