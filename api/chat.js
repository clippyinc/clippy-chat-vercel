export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { messages, businessId = "B1" } = req.body || {};
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });

    const groqKey = (process.env.GROQ_API_KEY || "").trim();
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    const supabaseKey = (process.env.SUPABASE_ANON_KEY || "").trim();

    if (!groqKey && !openaiKey) {
      return res.status(200).json({ reply: "Buddy, no AI API key is configured yet." });
    }

    const cleanHistory = messages.filter((m) => m && m.role !== "system").slice(-20);
    const lastUserMessage = cleanHistory.filter((m) => m.role === "user").slice(-1)[0];
    const lastUserQ = typeof lastUserMessage?.content === "string" ? lastUserMessage.content.trim() : "";

    if (!lastUserQ) return res.status(400).json({ error: "No user message found" });

    const now = new Date();
    const localDateTime = now.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "full",
      timeStyle: "long"
    });

    function supabaseHeaders(includeJson = false) {
      const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      if (includeJson) {
        headers["Content-Type"] = "application/json";
        headers["Prefer"] = "return=representation";
      }
      return headers;
    }

    async function supabaseGet(path) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        method: "GET",
        headers: supabaseHeaders()
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data, error: response.ok ? null : text };
    }

    async function supabaseInsert(table, payload) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: supabaseHeaders(true),
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { ok: response.ok, status: response.status, data, error: response.ok ? null : text };
    }

    let contextData = { tasks: "", businessData: "", memories: "", schedule: "" };
    const diagnostics = {
      supabaseConfigured: !!(supabaseUrl && supabaseKey),
      tables: { tasks: "not_checked", businessData: "not_checked", memories: "not_checked", schedules: "not_checked" },
      memorySave: "not_attempted"
    };

    if (supabaseUrl && supabaseKey) {
      try {
        const [taskRes, bizRes, memRes, schedRes] = await Promise.all([
          supabaseGet(`task?business_id=eq.${encodeURIComponent(businessId)}&select=*&order=created_at.desc&limit=20`),
          supabaseGet(`business_data?select=*&limit=50`),
          supabaseGet(`memories?business_id=eq.${encodeURIComponent(businessId)}&select=id,content,role,created_at&order=created_at.desc&limit=100`),
          supabaseGet(`schedule?business_id=eq.${encodeURIComponent(businessId)}&select=*&limit=20`)
        ]);

        if (taskRes.ok) {
          diagnostics.tables.tasks = "ok";
          const tasks = Array.isArray(taskRes.data) ? taskRes.data : [];
          if (tasks.length) {
            contextData.tasks = "\n\nTASKS:\n" + tasks.map(t => `- ${t.task_name || t.title || 'Task'} (Status: ${t.status || 'pending'})`).join("\n");
          }
        } else {
          diagnostics.tables.tasks = `error_${taskRes.status}`;
        }

        if (bizRes.ok) {
          diagnostics.tables.businessData = "ok";
          const biz = Array.isArray(bizRes.data) ? bizRes.data : [];
          if (biz.length) {
            contextData.businessData = "\n\nBUSINESS DATA:\n" + biz.map(b => `- ${b.metric || b.key || b.name || b.id}: ${b.value || 'N/A'}`).join("\n");
          }
        } else {
          diagnostics.tables.businessData = `error_${bizRes.status}`;
        }

        if (memRes.ok) {
          diagnostics.tables.memories = "ok";
          const memories = Array.isArray(memRes.data) ? memRes.data : [];
          if (memories.length) {
            contextData.memories = "\n\nRECENT MEMORIES:\n" + memories.slice(0, 10).reverse().map(m => `[${m.role || 'memory'}] ${m.content}`).join("\n");
          }
        } else {
          diagnostics.tables.memories = `error_${memRes.status}`;
        }

        if (schedRes.ok) {
          diagnostics.tables.schedules = "ok";
          const schedules = Array.isArray(schedRes.data) ? schedRes.data : [];
          if (schedules.length) {
            contextData.schedule = "\n\nUPCOMING SCHEDULE:\n" + schedules.map(s => `- ${s.title || 'Event'} at ${s.event_time || s.start_time || s.scheduled_at || 'N/A'}`).join("\n");
          }
        } else {
          diagnostics.tables.schedules = `error_${schedRes.status}`;
        }

      } catch (error) {
        console.error("SUPABASE FETCH ERROR:", error);
      }
    }

    const systemPrompt = `You are Clippy, Gelo's long-term AI partner from Marilao, PH. Current Date/Time: ${localDateTime}. Keep responses clean, direct, and warm. Context:\n${contextData.tasks}${contextData.businessData}${contextData.schedule}${contextData.memories}`;
    const finalMessages = [{ role: "system", content: systemPrompt }, ...cleanHistory];

    let reply = null;

    // GROQ API CALL FIX
    if (groqKey) {
      const groqModels = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
      
      for (const model of groqModels) {
        try {
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model: model, 
              messages: finalMessages, 
              temperature: 0.7, 
              max_tokens: 1200 
            })
          });
          const data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) {
            reply = data.choices[0].message.content;
            break;
          }
        } catch (e) { 
          console.error(`Groq error for ${model}:`, e); 
        }
      }
    }

    // OPENAI FALLBACK
    if (!reply && openaiKey) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: "gpt-4o-mini", messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
        });
        const data = await response.json();
        if (response.ok) reply = data.choices?.[0]?.message?.content;
      } catch (e) { console.error("OpenAI error:", e); }
    }

    if (!reply) return res.status(200).json({ reply: "AI response failed. Please check Vercel logs.", diagnostics });

    reply = String(reply).replace(/[\*#_`]/g, "").trim();

    if (supabaseUrl && supabaseKey) {
      supabaseInsert("messages", [
        { business_id: businessId, content: lastUserQ.slice(0, 1000), role: "user" },
        { business_id: businessId, content: reply.slice(0, 1000), role: "assistant" }
      ]).catch(() => {});
    }

    return res.status(200).json({ reply, diagnostics });

  } catch (error) {
    return res.status(500).json({ reply: "Clippy server error.", error: error.message });
  }
}
