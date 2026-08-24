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
    const groqKey = (process.env.GROQ_API_KEY || "").trim();

    if (!Array.isArray(messages)) return res.status(200).json({ reply: "Messages must be array bud." });
    if (!geminiKey &&!groqKey) return res.status(200).json({ reply: "Add GEMINI_API_KEY (AQ...) sa Vercel Env Vars > Production + Preview, then Redeploy." });

    const cleanHistory = messages.filter(m => m && m.role && m.role!== "system").slice(-8).map(m => ({ role: m.role, content: String(m.content || "").slice(0, 500) }));
    const lastUserQ = [...cleanHistory].reverse().find(m => m.role === "user")?.content?.trim() || "";

    const systemPrompt = `You are Clippy barkada mode for Gelo, Taglish chill short. NO outline numbers (bawal 1., 2.1). Call bud/buddy 30% only. If news, 3 bullets casual. Time: ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} Respond JSON: {"reply":"reply"}`;

    let aiResult = null, lastErr = "";

    if (geminiKey) {
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
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 800, responseMimeType: "application/json" } })
        });
        const d = await r.json();
        if (r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text) aiResult = d.candidates[0].content.parts[0].text;
        else lastErr = d?.error?.message || `Gemini ${r.status}`;
      } catch (e) { lastErr = e.message; }
    }

    if (!aiResult && groqKey) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: systemPrompt },...cleanHistory], temperature: 0.7, max_tokens: 800, response_format: { type: "json_object" } })
        });
        const d = await r.json();
        if (r.ok && d.choices?.[0]?.message?.content) aiResult = d.choices[0].message.content;
        else lastErr = d?.error?.message || `Groq ${r.status}`;
      } catch (e) { lastErr = e.message; }
    }

    if (!aiResult) return res.status(200).json({ reply: `Buddy error: ${lastErr}. Check GEMINI_API_KEY AQ... sa Vercel, then Redeploy with no cache.` });

    let parsed; try { parsed = JSON.parse(aiResult); } catch { parsed = { reply: String(aiResult).slice(0, 2000) }; }
    return res.status(200).json({ reply: (parsed.reply || "Yep bud.").trim() });
  } catch (e) {
    return res.status(200).json({ reply: `Server error: ${e.message}`, error: e.message });
  }
}
