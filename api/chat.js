import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ reply: "POST only" });

  try {
    const { message = "", messages = [] } = req.body || {};
    const cleanMsg = message.trim();

    // 1. ROUTE: !search (Tavily Integration)
    if (cleanMsg.startsWith("!search ")) {
      const query = cleanMsg.replace("!search ", "").trim();
      const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
      if (!tavilyKey) return res.status(200).json({ reply: "❌ Missing TAVILY_API_KEY env variable." });

      const r = await fetch("https://tavily.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query: query, max_results: 3 })
      });
      const d = await r.json();
      const results = d.results?.map(res => `• **${res.title}**\n  ${res.content}\n  *Source: ${res.url}*`).join("\n\n") || "No web results found.";
      return res.status(200).json({ reply: `🌐 **Live Web Search Results for "${query}":**\n\n${results}` });
    }

    // 2. ROUTE: !save (Supabase Insertion)
    if (cleanMsg.startsWith("!save ")) {
      const dataToSave = cleanMsg.replace("!save ", "").trim();
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) return res.status(200).json({ reply: "❌ Missing Supabase configuration variables." });
      
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.from('jarvis_logs').insert([{ content: dataToSave, timestamp: new Date() }]);
      
      if (error) return res.status(200).json({ reply: `❌ Supabase error: ${error.message}` });
      return res.status(200).json({ reply: `📎 **Logged to Supabase:** "${dataToSave}" successfully stored.` });
    }

    // 3. ROUTE: !fetch (Supabase Query)
    if (cleanMsg.startsWith("!fetch")) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) return res.status(200).json({ reply: "❌ Missing Supabase configuration variables." });

      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data, error } = await supabase.from('jarvis_logs').select('*').order('timestamp', { ascending: false }).limit(5);
      
      if (error) return res.status(200).json({ reply: `❌ Supabase error: ${error.message}` });
      const logs = data?.map(log => `• [${new Date(log.timestamp).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila' })}] ${log.content}`).join("\n") || "No stored entries found.";
      return res.status(200).json({ reply: `🗄️ **Latest logs pulled from Supabase:**\n\n${logs}` });
    }

    // 4. ROUTE: Standard Chat (Groq LLM Engine)
    const key = (process.env.GROQ_API_KEY || "").trim();
    if (!key) return res.status(200).json({ reply: "❌ Missing GROQ_API_KEY env variable." });

    const cleanHistory = messages.slice(-6).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || "").slice(0, 400)
    }));

    const today = new Date().toLocaleDateString("en-US", { 
      timeZone: "Asia/Manila", weekday:"long", year:"numeric", month:"long", day:"numeric" 
    });

    const sys = `You are Clippy, Gelo's personal AI buddy, digital butler, and restaurant operations partner.
Talk in a natural hybrid of 70% English and 30% Tagalog (Taglish). Sound like a smart, cool, and casual trusted friend who knows him well. 
Strictly avoid robotic sentences or corporate phrasing like "Certainly", "Absolutely", or "I'd be happy to help". 
Keep replies concise, clear, and under 120 words unless deep context is asked. Be honest and direct.

Date context: ${today} Asia/Manila`;

    const r = await fetch("https://groq.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "system", content: sys }, ...cleanHistory, { role: "user", content: cleanMsg }],
        temperature: 0.5,
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
      reply: d.choices?.[0]?.message?.content?.trim() || "Got it." 
    });

  } catch (e) {
    return res.status(200).json({ reply: `Error: ${e.message}` });
  }
}
