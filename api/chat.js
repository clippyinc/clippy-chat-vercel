export default async function handler(req, res) {
  // ============================================================
  // CLIPPY API CHAT
  // V2 — Improved Memory + Supabase + Groq + Tavily
  // ============================================================
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }
  try {
    // ============================================================
    // 1. INPUT
    // ============================================================
    const {
      messages,
      businessId = "B1"
    } = req.body || {};
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages required"
      });
    }
    // ============================================================
    // 2. ENVIRONMENT VARIABLES
    // ============================================================
    const groqKey = (process.env.GROQ_API_KEY || "").trim();
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();
    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();
    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
    // Use ANON key for now.
    // Do NOT expose a service-role key to the frontend.
    const supabaseKey = (
      process.env.SUPABASE_ANON_KEY || ""
    ).trim();
    if (!groqKey && !openaiKey) {
      return res.status(200).json({
        reply: "Buddy, no AI API key is configured yet.",
        diagnostics: {
          groq: false,
          openai: false
        }
      });
    }
    // ============================================================
    // 3. CLEAN CHAT HISTORY
    // ============================================================
    const cleanHistory = messages
      .filter((m) => m && m.role !== "system")
      .slice(-20);
    const lastUserMessage =
      cleanHistory
        .filter((m) => m.role === "user")
        .slice(-1)[0];
    const lastUserQ =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content.trim()
        : "";
    if (!lastUserQ) {
      return res.status(400).json({
        error: "No user message found"
      });
    }
    // ============================================================
    // 4. CURRENT USER CONTEXT
    // ============================================================
    const now = new Date();
    const localDateTime = now.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "full",
      timeStyle: "long"
    });
    // ============================================================
    // 5. SUPABASE HELPER
    // ============================================================
    function supabaseHeaders(includeJson = false) {
      const headers = {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      };
      if (includeJson) {
        headers["Content-Type"] = "application/json";
        headers["Prefer"] = "return=representation";
      }
      return headers;
    }
    async function supabaseGet(path) {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/${path}`,
        {
          method: "GET",
          headers: supabaseHeaders()
        }
      );
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok
          ? null
          : text
      };
    }
    async function supabaseInsert(table, payload) {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/${table}`,
        {
          method: "POST",
          headers: supabaseHeaders(true),
          body: JSON.stringify(payload)
        }
      );
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok
          ? null
          : text
      };
    }
    // ============================================================
    // 6. MEMORY / DATABASE CONTEXT
    // ============================================================
    let contextData = {
      tasks: "",
      businessData: "",
      memories: "",
      schedule: ""
    };
    const diagnostics = {
      supabaseConfigured: !!(
        supabaseUrl && supabaseKey
      ),
      tables: {
        tasks: "not_checked",
        businessData: "not_checked",
        memories: "not_checked",
        schedules: "not_checked"
      },
      memorySave: "not_attempted"
    };
    if (supabaseUrl && supabaseKey) {
      try {
        // ========================================================
        // Retrieve database information
        // ========================================================
        const [
          taskRes,
          bizRes,
          memRes,
          schedRes
        ] = await Promise.all([
          supabaseGet(
            `tasks?business_id=eq.${encodeURIComponent(
              businessId
            )}&is_done=eq.false&select=title,due_at&order=created_at.desc&limit=100`
          ),
          supabaseGet(
            `business_data?select=id,name&limit=100`
          ),
          // Retrieve up to 100 memories.
          // We will filter for relevance below.
          supabaseGet(
            `memories?business_id=eq.${encodeURIComponent(
              businessId
            )}&select=id,content,role,created_at&order=created_at.desc&limit=100`
          ),
          supabaseGet(
            `schedules?business_id=eq.${encodeURIComponent(
              businessId
            )}&select=title,scheduled_at,status&order=scheduled_at.asc&limit=100`
          )
        ]);
        // ========================================================
        // TASKS
        // ========================================================
        if (taskRes.ok) {
          diagnostics.tables.tasks = "ok";
          const tasks = Array.isArray(taskRes.data)
            ? taskRes.data
            : [];
          if (tasks.length) {
            contextData.tasks =
              "\n\nPENDING TASKS:\n" +
              tasks
                .map(
                  (t) =>
                    `- ${t.title} (Due: ${
                      t.due_at || "N/A"
                    })`
                )
                .join("\n");
          }
        } else {
          diagnostics.tables.tasks =
            `error_${taskRes.status}`;
          console.error(
            "TASKS QUERY FAILED:",
            taskRes.status,
            taskRes.error
          );
        }
        // ========================================================
        // BUSINESS DATA
        // ========================================================
        if (bizRes.ok) {
          diagnostics.tables.businessData = "ok";
          const business = Array.isArray(bizRes.data)
            ? bizRes.data
            : [];
          if (business.length) {
            contextData.businessData =
              "\n\nBUSINESS DATA:\n" +
              business
                .map(
                  (b) =>
                    `- ${b.id}: ${b.name}`
                )
                .join("\n");
          }
        } else {
          diagnostics.tables.businessData =
            `error_${bizRes.status}`;
          console.error(
            "BUSINESS DATA QUERY FAILED:",
            bizRes.status,
            bizRes.error
          );
        }
        // ========================================================
        // MEMORY
        // ========================================================
        if (memRes.ok) {
          diagnostics.tables.memories = "ok";
          const memories = Array.isArray(memRes.data)
            ? memRes.data
            : [];
          // ------------------------------------------------------
          // Simple relevance scoring.
          //
          // We retrieve up to 100 records from Supabase but
          // only send the most relevant records to the AI.
          // ------------------------------------------------------
          const queryWords = lastUserQ
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter(
              (word) => word.length >= 3
            );
          const scoredMemories = memories.map(
            (memory) => {
              const content = String(
                memory.content || ""
              ).toLowerCase();
              let score = 0;
              for (const word of queryWords) {
                if (content.includes(word)) {
                  score += 2;
                }
              }
              // More recent memories get a small bonus.
              const createdAt = new Date(
                memory.created_at || 0
              ).getTime();
              const ageDays =
                createdAt > 0
                  ? (Date.now() - createdAt) /
                    86400000
                  : 9999;
              if (ageDays <= 7) score += 1;
              if (ageDays <= 30) score += 0.5;
              return {
                ...memory,
                score
              };
            }
          );
          scoredMemories.sort(
            (a, b) => b.score - a.score
          );
          // Send only the top relevant memories.
          const relevantMemories =
            scoredMemories
              .filter(
                (memory) => memory.score > 0
              )
              .slice(0, 20);
          // If nothing matched, use a few recent memories.
          const memoriesToUse =
            relevantMemories.length
              ? relevantMemories
              : memories.slice(0, 5);
          if (memoriesToUse.length) {
            contextData.memories =
              "\n\nRELEVANT LONG-TERM MEMORIES:\n" +
              memoriesToUse
                .reverse()
                .map(
                  (m) =>
                    `[${m.role || "memory"}] ${
                      m.content
                    }`
                )
                .join("\n");
          }
        } else {
          diagnostics.tables.memories =
            `error_${memRes.status}`;
          console.error(
            "MEMORIES QUERY FAILED:",
            memRes.status,
            memRes.error
          );
        }
        // ========================================================
        // SCHEDULE
        // ========================================================
        if (schedRes.ok) {
          diagnostics.tables.schedules = "ok";
          const schedules = Array.isArray(
            schedRes.data
          )
            ? schedRes.data
            : [];
          if (schedules.length) {
            contextData.schedule =
              "\n\nUPCOMING SCHEDULE:\n" +
              schedules
                .map(
                  (s) =>
                    `- ${s.title} at ${
                      s.scheduled_at ||
                      "No date"
                    } (${s.status || "unknown"})`
                )
                .join("\n");
          }
        } else {
          diagnostics.tables.schedules =
            `error_${schedRes.status}`;
          console.error(
            "SCHEDULE QUERY FAILED:",
            schedRes.status,
            schedRes.error
          );
        }
      } catch (error) {
        console.error(
          "SUPABASE RETRIEVAL ERROR:",
          error
        );
      }
    }
    // ============================================================
    // 7. WEB SEARCH
    // ============================================================
    let webContext = "";
    const needsWeb =
      /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock|nba|weather in/i.test(
        lastUserQ
      );
    if (needsWeb && tavilyKey) {
      try {
        const searchResponse = await fetch(
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: lastUserQ,
              max_results: 5,
              search_depth: "basic",
              include_answer: true
            })
          }
        );
        const searchData =
          await searchResponse.json();
        if (
          searchResponse.ok &&
          searchData.results?.length
        ) {
          webContext =
            "\n\nCURRENT WEB INFORMATION:\n" +
            searchData.results
              .map(
                (result) =>
                  `- ${
                    result.title || "Source"
                  }: ${String(
                    result.content || ""
                  ).slice(0, 500)}`
              )
              .join("\n");
        } else {
          console.error(
            "TAVILY SEARCH FAILED:",
            searchData
          );
        }
      } catch (error) {
        console.error(
          "TAVILY ERROR:",
          error.message
        );
      }
    }
    // ============================================================
    // 8. CLIPPY SYSTEM PROMPT
    // ============================================================
    const systemPrompt = `
You are Clippy, Gelo's long-term AI thinking partner.
You are friendly, intelligent, natural, warm, practical and occasionally humorous.
Speak naturally in Tagalog-English when appropriate.
Do not sound robotic.
Do not ask a question at the end of every response.
Do not blindly agree with Gelo.
If an idea is unreasonable, risky or inefficient, explain it respectfully.
Use stored memories only when relevant.
Never invent memories.
If information is uncertain, say so.
Current local time in the Philippines:
${localDateTime}
Business/User context:
${businessId}
You currently have access to:
- Tasks
- Business data
- Long-term memories
- Schedules
- Current web information when available
Use the database information as factual context.
Do not claim that something was saved unless the system confirms the database operation succeeded.
Do not claim that an automation was performed unless the automation system confirms it.
Do not expose API keys, passwords or secrets.
${contextData.tasks}
${contextData.businessData}
${contextData.schedule}
${contextData.memories}
${webContext}
`;
    const finalMessages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...cleanHistory
    ];
    // ============================================================
    // 9. AI RESPONSE
    // ============================================================
    let reply = null;
    let lastError = "";
    // ============================================================
    // GROQ
    // ============================================================
    if (groqKey) {
      const models = [
        process.env.GROQ_MODEL ||
          "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-20b"
      ];
      for (const model of models) {
        try {
          console.log(
            "Trying Groq model:",
            model
          );
          const response = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
                Authorization:
                  `Bearer ${groqKey}`
              },
              body: JSON.stringify({
                model,
                messages: finalMessages,
                temperature: 0.7,
                max_tokens: 1200
              })
            }
          );
          const data =
            await response.json();
          if (
            response.ok &&
            data.choices?.[0]?.message?.content
          ) {
            reply =
              data.choices[0].message.content;
            console.log(
              "Groq response successful:",
              model
            );
            break;
          }
          lastError =
            data?.error?.message ||
            `Groq HTTP ${response.status}`;
          console.error(
            "Groq model failed:",
            model,
            lastError
          );
        } catch (error) {
          lastError = error.message;
          console.error(
            "Groq request error:",
            error
          );
        }
      }
    }
    // ============================================================
    // OPENAI FALLBACK
    // ============================================================
    if (!reply && openaiKey) {
      try {
        console.log(
          "Trying OpenAI fallback"
        );
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Authorization:
                `Bearer ${openaiKey}`
            },
            body: JSON.stringify({
              model:
                process.env.OPENAI_MODEL ||
                "gpt-4o-mini",
              messages: finalMessages,
              temperature: 0.7,
              max_tokens: 1200
            })
          }
        );
        const data =
          await response.json();
        if (
          response.ok &&
          data.choices?.[0]?.message?.content
        ) {
          reply =
            data.choices[0].message.content;
        } else {
          lastError =
            data?.error?.message ||
            `OpenAI HTTP ${response.status}`;
          console.error(
            "OpenAI failed:",
            lastError
          );
        }
      } catch (error) {
        lastError = error.message;
        console.error(
          "OpenAI request error:",
          error
        );
      }
    }
    // ============================================================
    // AI FAILURE
    // ============================================================
    if (!reply) {
      return res.status(200).json({
        reply:
          "Buddy, the AI request failed. Check the Vercel function logs.",
        diagnostics: {
          aiError: lastError,
          supabase: diagnostics
        }
      });
    }
    // ============================================================
    // 10. CLEAN RESPONSE
    // ============================================================
    reply = String(reply)
      .replace(/[\*#_`]/g, "")
      .trim();
    // ============================================================
    // 11. SAVE CHAT + MEMORY
    // ============================================================
    if (supabaseUrl && supabaseKey) {
      try {
        // --------------------------------------------------------
        // SAVE CHAT MESSAGES
        // --------------------------------------------------------
        const messageInsert =
          await supabaseInsert(
            "messages",
            [
              {
                business_id:
                  businessId,
                content:
                  lastUserQ.slice(0, 1000),
                role: "user"
              },
              {
                business_id:
                  businessId,
                content:
                  reply.slice(0, 1000),
                role: "assistant"
              }
            ]
          );
        if (messageInsert.ok) {
          console.log(
            "CHAT MESSAGES SAVED:",
            messageInsert.status
          );
        } else {
          console.error(
            "CHAT MESSAGE SAVE FAILED:",
            messageInsert.status,
            messageInsert.error
          );
        }
        // --------------------------------------------------------
        // MEMORY DETECTION
        // --------------------------------------------------------
        const memoryTrigger =
          /remember|save this|note that|my favorite|important|don't forget|do not forget|i like|i love|i prefer|my goal|my plan|my name|i work|i live/i.test(
            lastUserQ
          );
        if (memoryTrigger) {
          console.log(
            "IMPORTANT INPUT DETECTED — SAVING MEMORY"
          );
          const memoryInsert =
            await supabaseInsert(
              "memories",
              {
                business_id:
                  businessId,
                content:
                  lastUserQ.slice(0, 1000),
                role: "user"
              }
            );
          if (memoryInsert.ok) {
            diagnostics.memorySave =
              "saved";
            console.log(
              "MEMORY SAVED SUCCESSFULLY:",
              memoryInsert.status
            );
          } else {
            diagnostics.memorySave =
              `failed_${memoryInsert.status}`;
            console.error(
              "MEMORY SAVE FAILED:",
              memoryInsert.status,
              memoryInsert.error
            );
          }
        }
      } catch (error) {
        diagnostics.memorySave =
          "exception";
        console.error(
          "DATABASE SAVE ERROR:",
          error
        );
      }
    }
    // ============================================================
    // 12. RESPONSE TO FRONTEND
    // ============================================================
    return res.status(200).json({
      reply,
      diagnostics: {
        memory:
          diagnostics.memorySave,
        database:
          diagnostics.supabaseConfigured
            ? "connected"
            : "not_configured"
      }
    });
  } catch (error) {
    // ============================================================
    // GLOBAL ERROR HANDLER
    // ============================================================
    console.error(
      "CLIPPY API FATAL ERROR:",
      error
    );
    return res.status(500).json({
      reply:
        "Clippy encountered a server error.",
      error:
        error?.message ||
        "Unknown server error"
    });
  }
}
