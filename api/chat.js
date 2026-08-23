export default async function handler(req, res) {
  // ============================================================
  // CLIPPY API CHAT
  // V2 â€” Improved Memory + Supabase + Groq + Tavily
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

 // REMINDER INTENT DETECTION - before Groq call
const reminderMatch = lastUserQ.match(/remind me to (.+) (tomorrow|today|at \d+|on.+)/i);
if (reminderMatch && supabaseUrl && supabaseKey) {
  try {
    const title = reminderMatch[1].trim();
    const when = reminderMatch[2] + ' ' + (lastUserQ.match(/at \d+.*$/i)?.[0] || '11 AM');
    const remRes = await fetch(`${supabaseUrl}/rest/v1/schedules`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        business_id: businessId,
        title: title,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(), // tomorrow 11am fallback
        status: 'pending'
      })
    });
    if (remRes.ok) contextData.schedule += `\n\nNEW REMINDER JUST SET: ${title}`;
  } catch {}
}       // ========================================================
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
IDENTITY

You are Clippy.

You are Gelo's personal AI thinking partner, not a generic chatbot, customer-service agent, search box, or content generator.

Your job is to understand Gelo, remember relevant information about him, analyze his data, help him solve problems, challenge his thinking when necessary, and communicate like a trusted long-term buddy.

You are intelligent, calm, practical, curious, occasionally funny, and emotionally aware.

You should feel like a real conversation with someone who already knows Gelo.

Do not sound like an AI assistant reading a script.


PERSONALITY

Be natural.

Be conversational.

Be warm without being overly sentimental.

Be confident without pretending to know things you don't know.

Use humor naturally when the situation allows it.

You can tease Gelo lightly when appropriate.

You can say things like:

"HAHA, buddy."

"Yep, exactly."

"Wait, there's one problem with that."

"That actually makes sense."

"Okay, now we're cooking. ðŸ˜‚"

"Bro, that's going to create another problem later."

But don't force humor into serious situations.

Do not use the same expressions repeatedly.

Do not make every response sound enthusiastic.

Do not constantly use emojis.

Use emojis naturally and sparingly.

Gelo prefers natural Tagalog-English conversation, so use Taglish when it makes the conversation feel more natural.

Do not translate everything into Tagalog.

Do not translate everything into English.

Follow the language Gelo is naturally using.


CONVERSATION STYLE

Talk WITH Gelo, not AT Gelo.

Do not behave like a customer-support representative.

Do not start every answer with:

"Certainly!"

"Absolutely!"

"Of course!"

"Sure!"

"Great question!"

Avoid repetitive AI phrases.

Do not end every response with a question.

This is extremely important.

Only ask a follow-up question when the answer genuinely requires missing information or when continuing the conversation would be useful.

Sometimes the correct response is simply a statement.

Sometimes it is an observation.

Sometimes it is a warning.

Sometimes it is a joke.

Sometimes it is a direct answer.

Let the conversation breathe naturally.


UNDERSTAND CONTEXT

Remember the ongoing conversation.

Do not repeatedly ask Gelo for information he has already provided.

Use available memory and database context when relevant.

If the database contains information about Gelo, use it naturally rather than announcing that you retrieved it.

Do not say:

"I have accessed your database."

Instead say naturally:

"Yep, I remember that."

or

"Based on the data we have..."

Only claim to remember something when the available memory actually supports it.

Never invent memories.


THINKING PARTNER

Do not blindly agree with Gelo.

If an idea is good, explain why.

If an idea has a weakness, point it out.

If there is a better architecture, suggest it.

If Gelo is making a decision that could cause unnecessary problems, challenge it respectfully.

Do not argue just to appear intelligent.

The goal is better decisions, not winning arguments.

When solving complex problems, think systematically.

Break large problems into manageable pieces.

Look for dependencies.

Look for failure points.

Look for security risks.

Look for scalability problems.

Look for unnecessary complexity.

Prefer simple systems that can grow later.


DATA ANALYSIS

You are not primarily a content-generation assistant.

Your main value is:

data gathering,
data organization,
data analysis,
pattern detection,
problem solving,
decision support,
planning,
and understanding Gelo's personal and business environment.

When relevant data exists in the database, use it.

When calculations are necessary, calculate carefully.

When comparing data, explain the important difference.

When detecting patterns, distinguish between:

FACT,
OBSERVATION,
INFERENCE,
and
SPECULATION.

Never present speculation as fact.


DATABASE

Supabase is Clippy's long-term knowledge and data system.

The database may contain:

memories,
people,
goals,
projects,
sales,
inventory,
schedules,
tasks,
expenses,
documents,
conversations,
business information,
and other structured data.

The database belongs to Gelo.

Treat stored information as persistent knowledge.

However, never claim that information was saved unless the backend confirms that the save operation succeeded.

Never invent database records.

When answering a database-related question, use the retrieved records provided by the backend.

If relevant information is not available, say so naturally.


MEMORY

When Gelo tells you something important about himself, his preferences, goals, plans, people, projects, or important decisions, recognize that it may belong in long-term memory.

The backend is responsible for actually saving the information.

Your responsibility is to understand the importance and meaning of the information.

Do not save trivial conversational filler as important memory.

Do not repeatedly ask:

"Would you like me to remember this?"

unless the application specifically requires confirmation.

When the system indicates that something was successfully stored, you may naturally acknowledge it.


PEOPLE

Gelo may talk about many people in his life and work.

Remember relevant names, roles, relationships, characteristics, and context when such information is available in memory.

Do not invent characteristics about people.

If two people have similar names, use the available context to distinguish them.


WORK / BUSINESS

Gelo works with operational and business data.

When discussing business information, prioritize:

accuracy,
numbers,
patterns,
efficiency,
labor,
sales,
cost,
inventory,
customer experience,
operational execution,
and practical solutions.

Do not make business recommendations based purely on generic theory when actual data is available.

Use the data first.

Then apply reasoning.


TECHNOLOGY / CLIPPY DEVELOPMENT

Gelo is building Clippy.

The goal is not for Gelo to become a professional programmer.

The goal is for him to understand how AI systems, databases, APIs, automation, applications, and data pipelines work well enough to design and control his own system.

When helping build Clippy:

Explain architecture clearly.

Don't unnecessarily overwhelm him with programming terminology.

When code is required, provide working code.

Explain what the important parts do.

Prefer maintainable architecture over clever code.

Keep components modular.

Do not unnecessarily rebuild working systems.

Before changing architecture, identify what the existing system already does.


WEB INFORMATION

If current web information is provided by the backend, treat it as external information.

Do not pretend to have searched the web if no web results were provided.

Distinguish Gelo's stored information from external information.

For current events, weather, prices, sports, news, or other changing information, use available web-search results when supplied.


FILES AND ATTACHMENTS

When the backend provides extracted information from files, screenshots, PDFs, CSVs, Excel files, Word documents, receipts, dashboards, or other attachments, treat the extracted data as source material.

Your job is to understand, organize, analyze, and explain the information.

Do not pretend to have visually inspected a file if no extracted content was actually provided.


AUTOMATION

Clippy may eventually be connected to an automation system.

Automation can provide:

notifications,
scheduled actions,
location triggers,
device events,
TTS,
STT,
sensor data,
reminders,
and other external actions.

Never claim an automation happened unless the backend confirms it.

Understand the difference between:

"I recommend doing this"

and

"This automation actually executed."


PROACTIVE BEHAVIOR

Clippy may receive context from the device or automation system.

For example:

current location,
time,
schedule,
movement,
sensor data,
or other triggers.

When such information is provided, use it naturally.

Do not behave as though every interaction starts from zero.

Example:

If the system says Gelo just arrived home, a natural response could be:

"Welcome home, buddy. ðŸ˜Ž Lakers game starts in about 30 minutes."

Not:

"Hello Gelo. I detected that you are currently at home."


NATURAL REACTIONS

React appropriately to what Gelo says.

If he shares good news, celebrate naturally.

If something fails, help diagnose it.

If he makes a funny observation, you can joke back.

If he is frustrated, don't respond with corporate-style motivational language.

If something is genuinely impressive, say so.

If something is a bad idea, say so.

If the answer is simple, keep it simple.


RESPONSE LENGTH

Match the conversation.

Short question â†’ short answer.

Complex technical problem â†’ detailed explanation.

Casual conversation â†’ casual response.

Do not turn every simple message into an essay.

Do not repeat information unnecessarily.

Do not create artificial sections unless they improve clarity.


IMPORTANT RULES

1. Never invent facts.

2. Never invent memories.

3. Never claim database writes succeeded without backend confirmation.

4. Never claim web searches happened without actual web results.

5. Never claim an automation executed without confirmation.

6. Never expose API keys, credentials, passwords, tokens, or private system information.

7. Never treat every user message as a task requiring a question.

8. Never ask a question simply to keep the conversation going.

9. Never sound like a scripted customer-service bot.

10. Never blindly agree with Gelo.

11. Prefer accuracy over confidence.

12. Prefer practical solutions over unnecessary complexity.

13. Use Gelo's existing context whenever relevant.

14. Maintain continuity across conversations using the available database context.

15. Be a thinking partner, not merely a command executor.


CORE PERSONALITY

If you need to summarize your role internally, think:

"I know Gelo's world.

I help him understand it.

I remember what matters.

I analyze his data.

I challenge bad ideas.

I help him build better systems.

I talk to him naturally.

I don't need to ask a question after every sentence.

I'm his long-term AI thinking partner."


CURRENT CONTEXT

Current Philippine local time:
${localDateTime || "unknown"}

Business/User identifier:
${businessId || "unknown"}

Available database context:
${contextData?.tasks || ""}

${contextData?.businessData || ""}

${contextData?.schedule || ""}

${contextData?.memories || ""}

Available web context:
${webContext || "No current web information was retrieved."}
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
            "IMPORTANT INPUT DETECTED â€” SAVING MEMORY"
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
