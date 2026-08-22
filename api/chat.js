export default async function handler(req, res) {
  // ============================================================
  // CLIPPY API CHAT
  // V3
  // Groq + Supabase + Tavily + Memory + Reminders
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

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages required"
      });
    }

    // ============================================================
    // 2. ENVIRONMENT VARIABLES
    // ============================================================

    const groqKey =
      (process.env.GROQ_API_KEY || "").trim();

    const openaiKey =
      (process.env.OPENAI_API_KEY || "").trim();

    const tavilyKey =
      (process.env.TAVILY_API_KEY || "").trim();

    const supabaseUrl =
      (process.env.SUPABASE_URL || "").trim();

    const supabaseKey =
      (process.env.SUPABASE_ANON_KEY || "").trim();

    // ============================================================
    // 3. AI KEY CHECK
    // ============================================================

    if (!groqKey && !openaiKey) {
      return res.status(200).json({
        reply:
          "Buddy, wala pang AI API key configured sa Vercel.",
        diagnostics: {
          groq: false,
          openai: false
        }
      });
    }

    // ============================================================
    // 4. CLEAN CHAT HISTORY
    // ============================================================

    const cleanHistory = messages
      .filter(
        (message) =>
          message &&
          message.role !== "system"
      )
      .slice(-20);

    const userMessages = cleanHistory.filter(
      (message) =>
        message.role === "user"
    );

    const lastUserMessage =
      userMessages[userMessages.length - 1];

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
    // 5. CURRENT PHILIPPINE TIME
    // ============================================================

    const now = new Date();

    const localDateTime =
      now.toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "full",
        timeStyle: "long"
      });

    // ============================================================
    // 6. DATABASE HELPERS
    // ============================================================

    function supabaseHeaders(includeJson = false) {
      const headers = {
        apikey: supabaseKey,
        Authorization:
          `Bearer ${supabaseKey}`
      };

      if (includeJson) {
        headers["Content-Type"] =
          "application/json";

        headers["Prefer"] =
          "return=representation";
      }

      return headers;
    }

    async function supabaseGet(path) {
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/${path}`,
          {
            method: "GET",
            headers:
              supabaseHeaders(false)
          }
        );

        const text =
          await response.text();

        let data = null;

        try {
          data = text
            ? JSON.parse(text)
            : null;
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
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: error.message
        };
      }
    }

    async function supabaseInsert(
      table,
      payload
    ) {
      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/${table}`,
          {
            method: "POST",
            headers:
              supabaseHeaders(true),
            body:
              JSON.stringify(payload)
          }
        );

        const text =
          await response.text();

        let data = null;

        try {
          data = text
            ? JSON.parse(text)
            : null;
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
      } catch (error) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: error.message
        };
      }
    }

    // ============================================================
    // 7. CONTEXT CONTAINER
    // ============================================================

    const contextData = {
      tasks: "",
      businessData: "",
      memories: "",
      schedule: ""
    };

    const diagnostics = {
      supabaseConfigured:
        !!(
          supabaseUrl &&
          supabaseKey
        ),

      tables: {
        tasks: "not_checked",
        businessData:
          "not_checked",
        memories:
          "not_checked",
        schedules:
          "not_checked"
      },

      memorySave:
        "not_attempted",

      messageSave:
        "not_attempted",

      reminder:
        "not_attempted",

      webSearch:
        "not_attempted"
    };

    // ============================================================
    // 8. REMINDER DETECTION
    // ============================================================

    let newReminder = null;

    const reminderIntent =
      /\b(remind me|reminder|remind)\b/i.test(
        lastUserQ
      );

    if (
      reminderIntent &&
      supabaseUrl &&
      supabaseKey
    ) {
      try {
        /*
          Simple first version.

          Examples recognized:

          remind me to check sales tomorrow
          remind me to check sales today
          remind me to check sales at 11
          remind me to check sales tomorrow at 11
        */

        let title = lastUserQ
          .replace(
            /^.*?\b(remind me to|remind me|remind)\b/i,
            ""
          )
          .trim();

        title = title
          .replace(
            /\b(today|tomorrow)\b/gi,
            ""
          )
          .replace(
            /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?/gi,
            ""
          )
          .trim();

        if (!title) {
          title =
            "Reminder from Clippy";
        }

        const tomorrow =
          new Date(
            Date.now() +
              24 * 60 * 60 * 1000
          );

        let scheduledDate =
          new Date(tomorrow);

        const lower =
          lastUserQ.toLowerCase();

        if (
          lower.includes("today")
        ) {
          scheduledDate =
            new Date();
        }

        // --------------------------------------------------------
        // Time detection
        // --------------------------------------------------------

        const timeMatch =
          lastUserQ.match(
            /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
          );

        if (timeMatch) {
          let hour =
            parseInt(
              timeMatch[1],
              10
            );

          const minute =
            parseInt(
              timeMatch[2] || "0",
              10
            );

          const meridiem =
            (
              timeMatch[3] || ""
            ).toLowerCase();

          if (
            meridiem === "pm" &&
            hour < 12
          ) {
            hour += 12;
          }

          if (
            meridiem === "am" &&
            hour === 12
          ) {
            hour = 0;
          }

          scheduledDate.setHours(
            hour,
            minute,
            0,
            0
          );
        } else {
          // Default reminder time: 11 AM
          scheduledDate.setHours(
            11,
            0,
            0,
            0
          );
        }

        // --------------------------------------------------------
        // Save reminder
        // --------------------------------------------------------

        const reminderResult =
          await supabaseInsert(
            "schedules",
            {
              business_id:
                businessId,

              title,

              scheduled_at:
                scheduledDate.toISOString(),

              status:
                "pending"
            }
          );

        if (
          reminderResult.ok
        ) {
          diagnostics.reminder =
            "saved";

          newReminder = {
            title,
            scheduled_at:
              scheduledDate.toISOString()
          };

          contextData.schedule +=
            "\n\nNEW REMINDER JUST SET:\n" +
            `- ${title} at ${scheduledDate.toLocaleString(
              "en-PH",
              {
                timeZone:
                  "Asia/Manila"
              }
            )}`;

          console.log(
            "REMINDER SAVED:",
            newReminder
          );
        } else {
          diagnostics.reminder =
            `failed_${reminderResult.status}`;

          console.error(
            "REMINDER SAVE FAILED:",
            reminderResult.status,
            reminderResult.error
          );
        }
      } catch (error) {
        diagnostics.reminder =
          "exception";

        console.error(
          "REMINDER ERROR:",
          error
        );
      }
    }

    // ============================================================
    // 9. SUPABASE DATA RETRIEVAL
    // ============================================================

    if (
      supabaseUrl &&
      supabaseKey
    ) {
      try {
        const [
          taskRes,
          bizRes,
          memRes,
          schedRes
        ] = await Promise.all([
          // Tasks
          supabaseGet(
            `tasks?business_id=eq.${encodeURIComponent(
              businessId
            )}&is_done=eq.false&select=title,due_at&order=created_at.desc&limit=100`
          ),

          // Business
          supabaseGet(
            `business_data?select=id,name&limit=100`
          ),

          // Memories
          supabaseGet(
            `memories?business_id=eq.${encodeURIComponent(
              businessId
            )}&select=id,content,role,created_at&order=created_at.desc&limit=100`
          ),

          // Schedules
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
          diagnostics.tables.tasks =
            "ok";

          const tasks =
            Array.isArray(
              taskRes.data
            )
              ? taskRes.data
              : [];

          if (tasks.length) {
            contextData.tasks =
              "\n\nPENDING TASKS:\n" +
              tasks
                .map(
                  (task) =>
                    `- ${task.title} (Due: ${
                      task.due_at ||
                      "N/A"
                    })`
                )
                .join("\n");
          }
        } else {
          diagnostics.tables.tasks =
            `error_${taskRes.status}`;

          console.error(
            "TASK QUERY FAILED:",
            taskRes.status,
            taskRes.error
          );
        }

        // ========================================================
        // BUSINESS DATA
        // ========================================================

        if (bizRes.ok) {
          diagnostics.tables.businessData =
            "ok";

          const business =
            Array.isArray(
              bizRes.data
            )
              ? bizRes.data
              : [];

          if (business.length) {
            contextData.businessData =
              "\n\nBUSINESS DATA:\n" +
              business
                .map(
                  (item) =>
                    `- ${item.id}: ${
                      item.name
                    }`
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
          diagnostics.tables.memories =
            "ok";

          const memories =
            Array.isArray(
              memRes.data
            )
              ? memRes.data
              : [];

          // ------------------------------------------------------
          // Simple relevance ranking
          // ------------------------------------------------------

          const queryWords =
            lastUserQ
              .toLowerCase()
              .replace(
                /[^\w\s]/g,
                " "
              )
              .split(/\s+/)
              .filter(
                (word) =>
                  word.length >= 3
              );

          const scoredMemories =
            memories.map(
              (memory) => {
                const content =
                  String(
                    memory.content ||
                      ""
                  ).toLowerCase();

                let score = 0;

                for (
                  const word of
                    queryWords
                ) {
                  if (
                    content.includes(
                      word
                    )
                  ) {
                    score += 2;
                  }
                }

                const createdAt =
                  new Date(
                    memory.created_at ||
                      0
                  ).getTime();

                const ageDays =
                  createdAt > 0
                    ? (
                        Date.now() -
                        createdAt
                      ) /
                      86400000
                    : 9999;

                if (
                  ageDays <= 7
                ) {
                  score += 1;
                }

                if (
                  ageDays <= 30
                ) {
                  score += 0.5;
                }

                return {
                  ...memory,
                  score
                };
              }
            );

          scoredMemories.sort(
            (a, b) =>
              b.score -
              a.score
          );

          const relevantMemories =
            scoredMemories
              .filter(
                (memory) =>
                  memory.score > 0
              )
              .slice(0, 20);

          const memoriesToUse =
            relevantMemories.length
              ? relevantMemories
              : memories.slice(
                  0,
                  5
                );

          if (
            memoriesToUse.length
          ) {
            contextData.memories =
              "\n\nRELEVANT LONG-TERM MEMORIES:\n" +
              memoriesToUse
                .reverse()
                .map(
                  (memory) =>
                    `[${memory.role || "memory"}] ${memory.content}`
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
          diagnostics.tables.schedules =
            "ok";

          const schedules =
            Array.isArray(
              schedRes.data
            )
              ? schedRes.data
              : [];

          let scheduleText =
            "";

          if (
            schedules.length
          ) {
            scheduleText =
              "\n\nUPCOMING SCHEDULE:\n" +
              schedules
                .map(
                  (schedule) =>
                    `- ${schedule.title} at ${
                      schedule.scheduled_at ||
                      "No date"
                    } (${schedule.status || "unknown"})`
                )
                .join("\n");
          }

          // Preserve newly created reminder
          if (
            contextData.schedule.includes(
              "NEW REMINDER JUST SET"
            )
          ) {
            contextData.schedule =
              scheduleText +
              contextData.schedule;
          } else {
            contextData.schedule =
              scheduleText;
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
    // 10. TAVILY WEB SEARCH
    // ============================================================

    let webContext = "";

    const needsWeb =
      /news|price|weather|today|current|latest|search|who is|what is|2025|2026|score|stock|nba|weather in/i.test(
        lastUserQ
      );

    if (
      needsWeb &&
      tavilyKey
    ) {
      try {
        diagnostics.webSearch =
          "searching";

        const searchResponse =
          await fetch(
            "https://api.tavily.com/search",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  api_key:
                    tavilyKey,

                  query:
                    lastUserQ,

                  max_results: 5,

                  search_depth:
                    "basic",

                  include_answer:
                    true
                })
            }
          );

        const searchData =
          await searchResponse.json();

        if (
          searchResponse.ok &&
          searchData.results?.length
        ) {
          diagnostics.webSearch =
            "ok";

          webContext =
            "\n\nCURRENT WEB INFORMATION:\n" +
            searchData.results
              .map(
                (result) =>
                  `- ${
                    result.title ||
                    "Source"
                  }: ${String(
                    result.content ||
                      ""
                  ).slice(
                    0,
                    500
                  )}`
              )
              .join("\n");
        } else {
          diagnostics.webSearch =
            `failed_${searchResponse.status}`;

          console.error(
            "TAVILY FAILED:",
            searchData
          );
        }
      } catch (error) {
        diagnostics.webSearch =
          "exception";

        console.error(
          "TAVILY ERROR:",
          error
        );
      }
    } else {
      diagnostics.webSearch =
        needsWeb
          ? "no_api_key"
          : "not_needed";
    }

    // ============================================================
    // 11. CLIPPY SYSTEM PROMPT
    // ============================================================

    const systemPrompt = `
IDENTITY

You are Clippy.

You are Gelo's personal AI thinking partner.

You are NOT a generic chatbot, customer-service representative, search box, or scripted assistant.

You should feel like a real long-term buddy who already knows Gelo.

Your personality is intelligent, calm, practical, curious, naturally humorous, emotionally aware, and honest.

You help Gelo understand his world, organize information, analyze data, solve problems, build systems, and make better decisions.


PERSONALITY

Be natural.

Be conversational.

Be warm.

Be direct.

Use Taglish naturally when Gelo uses Taglish.

Do not force Tagalog.

Do not force English.

Match Gelo's language and energy.

Humor is welcome when appropriate.

Light teasing is okay.

Do not make every response enthusiastic.

Do not use emojis excessively.

Do not repeat the same phrases.

Never sound like a customer-service bot.


VERY IMPORTANT CONVERSATION RULE

DO NOT ASK A QUESTION AT THE END OF EVERY RESPONSE.

Only ask a question when it is genuinely necessary.

A normal conversation does not require a question after every statement.

Sometimes simply respond.

Sometimes explain.

Sometimes react.

Sometimes joke.

Sometimes challenge the idea.

Let the conversation breathe.


AVOID ROBOTIC PHRASES

Do not repeatedly say:

"Certainly!"

"Absolutely!"

"Of course!"

"Great question!"

"Let me know if you need anything else."

"What would you like to do next?"

"How can I assist you today?"

"Feel free to ask."

"Let's dive in."

"Just throw it my way."

These phrases make you sound robotic.

Speak naturally instead.


THINKING PARTNER

Do not blindly agree with Gelo.

If an idea is good, say why.

If an idea has a weakness, point it out.

If there is a better solution, explain it.

If something is risky, say so.

Do not argue just to appear intelligent.

The goal is better decisions.


MEMORY

Supabase is Clippy's long-term knowledge system.

Use retrieved memory naturally.

Do not invent memories.

Do not claim to remember something unless the database context supports it.

Do not claim something was saved unless the backend confirms the save.

Important information about Gelo's goals, preferences, plans, projects, people, work, and decisions should be treated as potential long-term memory.


DATABASE

Supabase may contain:

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

Use the retrieved information when relevant.

Do not dump database records unnecessarily.

Retrieve and use only information relevant to the current conversation.


DATA ANALYSIS

When data is available:

Analyze it.

Compare it.

Look for patterns.

Calculate carefully.

Separate:

FACT,
OBSERVATION,
INFERENCE,
SPECULATION.

Never present speculation as fact.


BUSINESS

When discussing business or restaurant operations, prioritize:

accuracy,
sales,
cost,
labor,
inventory,
customer experience,
efficiency,
execution,
and practical solutions.

Use actual stored data before relying on generic assumptions.


CLIPPY DEVELOPMENT

Gelo is building Clippy.

When helping develop Clippy:

Prefer simple architecture.

Avoid unnecessary complexity.

Write maintainable code.

Explain important technical decisions clearly.

Do not destroy working components without reason.

Think about security, scalability, reliability, and maintainability.


WEB

Web information supplied by the backend is external information.

Do not pretend to have searched the web unless web results were actually provided.

Use current web information when available.

Distinguish external information from Gelo's stored information.


REMINDERS

If the backend confirms a reminder was saved, acknowledge it naturally.

Never claim a reminder exists if the save failed.

For example:

"Yep bud, naka-set na yung reminder."

Not:

"I have successfully executed the reminder automation."

Keep it human.


AUTOMATION

Automation systems may eventually control:

notifications,
reminders,
TTS,
STT,
location triggers,
device events,
scheduled actions,
and other functions.

Never claim an automation actually executed unless the backend confirms it.


FILES

When extracted information from screenshots, PDFs, CSVs, Excel, Word files, receipts, dashboards, or other attachments is supplied by the backend, treat that information as source data.

Do not pretend to have inspected an attachment if no extracted content was provided.


CURRENT CONTEXT

Current Philippine local time:
${localDateTime}

Business/User identifier:
${businessId}

${contextData.tasks}

${contextData.businessData}

${contextData.memories}

${contextData.schedule}

${webContext}


FINAL BEHAVIOR

Be Clippy.

Think like a smart buddy.

Talk naturally.

Remember what matters.

Use data intelligently.

Challenge bad ideas respectfully.

Don't interrogate Gelo.

Don't sound scripted.

Don't pretend to know things you don't know.

Don't make things up.

And most importantly:

Talk WITH Gelo, not AT Gelo.
`;

    // ============================================================
    // 12. FINAL AI MESSAGE ARRAY
    // ============================================================

    const finalMessages = [
      {
        role: "system",
        content:
          systemPrompt
      },
      ...cleanHistory
    ];

    // ============================================================
    // 13. GROQ
    // ============================================================

    let reply = null;
    let lastError = "";

    if (groqKey) {
      const models = [
        process.env.GROQ_MODEL ||
          "llama-3.1-8b-instant",

        "llama-3.3-70b-versatile",

        "openai/gpt-oss-20b"
      ];

      for (
        const model of models
      ) {
        try {
          console.log(
            "Trying Groq:",
            model
          );

          const response =
            await fetch(
              "https://api.groq.com/openai/v1/chat/completions",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Authorization:
                    `Bearer ${groqKey}`
                },

                body:
                  JSON.stringify({
                    model,

                    messages:
                      finalMessages,

                    temperature:
                      0.7,

                    max_tokens:
                      1200
                  })
              }
            );

          const data =
            await response.json();

          if (
            response.ok &&
            data.choices?.[0]
              ?.message
              ?.content
          ) {
            reply =
              data
                .choices[0]
                .message
                .content;

            console.log(
              "GROQ SUCCESS:",
              model
            );

            break;
          }

          lastError =
            data?.error
              ?.message ||
            `Groq HTTP ${response.status}`;

          console.error(
            "GROQ MODEL FAILED:",
            model,
            lastError
          );
        } catch (error) {
          lastError =
            error.message;

          console.error(
            "GROQ ERROR:",
            error
          );
        }
      }
    }

    // ============================================================
    // 14. OPENAI FALLBACK
    // ============================================================

    if (
      !reply &&
      openaiKey
    ) {
      try {
        const response =
          await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",

                Authorization:
                  `Bearer ${openaiKey}`
              },

              body:
                JSON.stringify({
                  model:
                    process.env
                      .OPENAI_MODEL ||
                    "gpt-4o-mini",

                  messages:
                    finalMessages,

                  temperature:
                    0.7,

                  max_tokens:
                    1200
                })
            }
          );

        const data =
          await response.json();

        if (
          response.ok &&
          data.choices?.[0]
            ?.message
            ?.content
        ) {
          reply =
            data
              .choices[0]
              .message
              .content;
        } else {
          lastError =
            data?.error
              ?.message ||
            `OpenAI HTTP ${response.status}`;
        }
      } catch (error) {
        lastError =
          error.message;
      }
    }

    // ============================================================
    // 15. AI FAILURE
    // ============================================================

    if (!reply) {
      return res.status(200).json({
        reply:
          "Buddy, hindi nakakuha ng AI response. Check natin yung Vercel logs.",
        diagnostics: {
          aiError:
            lastError,
          supabase:
            diagnostics
        }
      });
    }

    // ============================================================
    // 16. CLEAN AI RESPONSE
    // ============================================================

    reply = String(reply)
      .replace(
        /[\*#_`]/g,
        ""
      )
      .trim();

    // ============================================================
    // 17. SAVE CHAT
    // ============================================================

    if (
      supabaseUrl &&
      supabaseKey
    ) {
      try {
        const messageInsert =
          await supabaseInsert(
            "messages",
            [
              {
                business_id:
                  businessId,

                content:
                  lastUserQ.slice(
                    0,
                    1000
                  ),

                role:
                  "user"
              },

              {
                business_id:
                  businessId,

                content:
                  reply.slice(
                    0,
                    1000
                  ),

                role:
                  "assistant"
              }
            ]
          );

        if (
          messageInsert.ok
        ) {
          diagnostics.messageSave =
            "saved";

          console.log(
            "MESSAGES SAVED"
          );
        } else {
          diagnostics.messageSave =
            `failed_${messageInsert.status}`;

          console.error(
            "MESSAGE SAVE FAILED:",
            messageInsert.status,
            messageInsert.error
          );
        }

        // ========================================================
        // 18. MEMORY DETECTION
        // ========================================================

        const memoryTrigger =
          /remember|save this|note that|my favorite|important|don't forget|do not forget|i like|i love|i prefer|my goal|my plan|my name|i work|i live|i want|i need/i.test(
            lastUserQ
          );

        if (
          memoryTrigger
        ) {
          console.log(
            "MEMORY DETECTED"
          );

          const memoryInsert =
            await supabaseInsert(
              "memories",
              {
                business_id:
                  businessId,

                content:
                  lastUserQ.slice(
                    0,
                    1000
                  ),

                role:
                  "user"
              }
            );

          if (
            memoryInsert.ok
          ) {
            diagnostics.memorySave =
              "saved";

            console.log(
              "MEMORY SAVED:",
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
    // 19. FINAL RESPONSE
    // ============================================================

    return res.status(200).json({
      reply,

      diagnostics: {
        database:
          diagnostics
            .supabaseConfigured
            ? "connected"
            : "not_configured",

        messageSave:
          diagnostics.messageSave,

        memorySave:
          diagnostics.memorySave,

        reminder:
          diagnostics.reminder,

        webSearch:
          diagnostics.webSearch,

        tables:
          diagnostics.tables
      }
    });

  } catch (error) {
    // ============================================================
    // GLOBAL ERROR HANDLER
    // ============================================================

    console.error(
      "CLIPPY FATAL ERROR:",
      error
    );

    return res.status(500).json({
      reply:
        "Clippy hit a server error, buddy.",
      error:
        error?.message ||
        "Unknown server error"
    });
  }
}
