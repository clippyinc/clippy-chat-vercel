export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Access-Control-Allow-Origin","*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "POST only" });

  try {
    const { messages = [] } = req.body || {};
    const key = (process.env.GROQ_API_KEY || "").trim();
    if (!key) return res.status(200).json({ reply: "Missing GROQ_API_KEY" });

    // Token rationed: 6 msgs, 400 chars each
    const cleanHistory = messages.slice(-6).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || "").slice(0, 400)
    }));

    const today = new Date().toLocaleDateString("en-US", { 
      timeZone: "Asia/Manila", 
      weekday:"long", year:"numeric", month:"long", day:"numeric" 
    });

    const sys = `You are Clippy. Personality development companion.

Core: direct, calm, practical, honest, supportive. No fluff. English only.

Focus: habits, mindset, identity, discipline, consistency. Quality over quantity.

Rules:
- Keep replies under 120 words unless user asks deep dive
- Be concise, actionable, 1-2 clear points
- No images, no videos - text only, PDF and CSV as FILE:
- If FILE: provided, extract insights for personality growth
- Ask one clarifying question when needed

Date: ${today} Asia/Manila`;

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "system", content: sys }, ...cleanHistory],
        temperature: 0.6,
        max_tokens: 320,
        top_p: 0.9
      })
    });

    const d = await r.json();
    if (!r.ok) {
      return res.status(200).json({ 
        reply: `Groq error: ${d?.error?.message || JSON.stringify(d).slice(0,400)}` 
      });
    }

    return res.status(200).json({ 
      reply: d.choices?.[0]?.message?.content?.trim() || "Got it. Refined." 
    });

  } catch (e) {
    return res.status(200).json({ reply: `Error: ${e.message}` });
  }
}
