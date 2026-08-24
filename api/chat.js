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
    if (!geminiKey) return res.status(200).json({ reply: "Wala pa GEMINI_API_KEY mo bud! Vercel > Settings > Env Vars > Add GEMINI_API_KEY = AQ... mo (Production + Preview), then Redeploy with NO cache." });

    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) }));
    const lastUserQ = [...cleanHistory].reverse().find(m => m.role === "user")?.content?.trim() || "";
    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "long" });

    const systemPrompt = `You are Clippy barkada mode for Gelo. Taglish chill short. NO outline numbers (bawal 1., 2.1). Call bud/buddy 30% only. If news, 3 bullets casual. Time: ${now} Respond JSON: {"reply":"reply"}`;

    let aiResult = null, lastErr = "";

    // GEMINI AQ... - try 2 models + handle AQ format
    for (const model of ["gemini-1.5-flash", "gemini-1.5-flash-8b"]) {
      try {
        const contents = [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Gets, no outline." }] }
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
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: "application/json" } })
        });
        const d = await r.json();
        if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) { aiResult = d.candidates[0].content.parts[0].text; break; }
        lastErr = d?.error?.message || `Gemini ${model} ${r.status}: ${JSON.stringify(d).slice(0, 400)}`;
        console.error("Gemini fail:", lastErr);
        if (r.status===400 || r.status===403) break; // invalid key, don't retry
      } catch (e) { lastErr = e.message; console.error(e); }
    }

    if (!aiResult) {
      return res.status(200).json({ 
        reply: `Buddy Gemini error: ${lastErr}. Fix: 1) Vercel > Env Vars > GEMINI_API_KEY mo ba AQ... na may space? Dapat walang space. 2) Get new key sa aistudio.google.com > Create API key > Copy AQ... 3) Add sa Vercel Production+Preview 4) Redeploy with NO cache. Wag na Groq, dead na models.`,
        error: lastErr
      });
    }

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult).slice(0, 2000) }; }
    return res.status(200).json({ reply: (parsed.reply || "Yep bud.").trim() });
  } catch (e) {
    console.error("FATAL:", e);
    return res.status(200).json({ reply: `Server error: ${e.message}`, error: e.message });
  }
}
