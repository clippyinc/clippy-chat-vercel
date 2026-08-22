export default async function handler(req, res) {
  // ============================================================
  // CLIPPY CHAT API — V3
  // Supabase + Groq + OpenAI fallback + Tavily
  // Natural conversation + structured database actions
  // ============================================================

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // ==========================================================
    // 1. INPUT
    // ==========================================================

    const {
      messages,
      businessId = "B1"
    } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        error: "messages must be an array"
      });
    }

    // ==========================================================
    // 2. ENVIRONMENT VARIABLES
    // ==========================================================

    const groqKey =
      (process.env.GROQ_API_KEY || "").trim();

    const openaiKey =
      (process.env.OPENAI_API_KEY || "").trim();

    const tavilyKey =
      (process.env.TAVILY_API_KEY || "").trim();

    const supabaseUrl =
      (process.env.SUPABASE_URL || "").trim();

    /*
      Server-side priority:

      1. SUPABASE_SERVICE_ROLE_KEY
      2. SUPABASE_ANON_KEY

      IMPORTANT:
      Never send the service-role key to the frontend.
      It is safe to use here because this code runs on Vercel.
    */

    const supabaseKey =
      (
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        ""
      ).trim();

    if (!groqKey && !openaiKey) {
      return res.status(200).json({
        reply:
          "Buddy, wala pa akong AI API key. Add GROQ_API_KEY sa Vercel environment variables.",
        diagnostics: {
          groq: false,
          openai: false,
          supabase: !!(
            supabaseUrl && supabaseKey
          )
        }
      });
    }

    // ==========================================================
    // 3. CLEAN CHAT HISTORY
    // ==========================================================

    const cleanHistory = messages
      .filter(
        (message) =>
          message &&
          message.role &&
          message.role !== "system"
      )
      .slice(-30);

    const lastUserMessage =
      [...cleanHistory]
        .reverse()
        .find(
          (message) =>
            message.role === "user"
        );

    const lastUserQ =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content.trim()
        : "";

    if (!lastUserQ) {
      return res.status(400).json({
        error: "No user message found"
      });
    }

    // ==========================================================
    // 4. CURRENT TIME / LOCATION
    // ==========================================================

    const now = new Date();

    const localDateTime =
      now.toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "full",
        timeStyle: "long"
      });

    const isoNow =
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(now);

    // ==========================================================
    // 5. DATABASE HELPERS
    // ==========================================================

    const diagnostics = {
      supabaseConfigured: !!(
        supabaseUrl && supabaseKey
      ),

      tables: {
        tasks: "not_checked",
        schedules: "not_checked",
        memories: "not_checked",
        business_data: "not_checked",
        messages: "not_checked"
      },

      actions: []
    };

    function supabaseHeaders(json = false) {
      const headers = {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      };

      if (json) {
        headers["Content-Type"] =
          "application/json";

        headers["Prefer"] =
          "return=representation";
      }

      return headers;
    }

    async function supabaseRequest(
      method,
      table,
      query = "",
      body = null
    ) {
      if (!supabaseUrl || !supabaseKey) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: "Supabase is not configured"
        };
      }

      try {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/${table}${query}`,
          {
            method,
            headers: supabaseHeaders(
              method !== "GET"
            ),
            body:
              body !== null
                ? JSON.stringify(body)
                : undefined
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
          error:
            error?.message ||
            "Unknown Supabase error"
        };
      }
    }

    async function supabaseGet(
      table,
      query
    ) {
      return supabaseRequest(
        "GET",
        table,
        query
      );
    }

    async function supabaseInsert(
      table,
      payload
    ) {
      return supabaseRequest(
        "POST",
        table,
        "",
        payload
      );
    }

    // ==========================================================
    // 6. DATABASE CONTEXT
    // ==========================================================

    let contextData = {
      tasks: "",
      schedules: "",
      memories: "",
      businessData: ""
    };

    let rawData = {
      tasks: [],
      schedules: [],
      memories: [],
      businessData: []
    };

    if (supabaseUrl && supabaseKey) {
      try {
        const [
          taskRes,
          scheduleRes,
          memoryRes,
          businessRes
        ] = await Promise.all([
          // -------------------------------
          // TASKS
          // -------------------------------

          supabaseGet(
            "tasks",
            `?business_id=eq.${encodeURIComponent(
              businessId
            )}&is_done=eq.false&select=*&order=created_at.desc&limit=100`
          ),

          // -------------------------------
          // SCHEDULES
          // -------------------------------

          supabaseGet(
            "schedules",
            `?business_id=eq.${encodeURIComponent(
              businessId
            )}&select=*&order=scheduled_at.asc&limit=100`
          ),

          // -------------------------------
          // MEMORIES
          // -------------------------------

          supabaseGet(
            "memories",
            `?business_id=eq.${encodeURIComponent(
              businessId
            )}&select=*&order=created_at.desc&limit=100`
          ),

          // -------------------------------
          // BUSINESS DATA
          // -------------------------------

          /*
            We intentionally use select=*
            so Clippy can actually see all
            useful business_data columns.
          */

          supabaseGet(
            "business_data",
            `?select=*&limit=100`
          )
        ]);

        // ======================================================
        // TASKS
        // ======================================================

        if (taskRes.ok) {
          diagnostics.tables.tasks = "ok";

          rawData.tasks =
            Array.isArray(taskRes.data)
              ? taskRes.data
              : [];

          if (rawData.tasks.length) {
            contextData.tasks =
              "\n\nPENDING TASKS:\n" +
              rawData.tasks
                .map((task) => {
                  return (
                    `- ${task.title || "Untitled task"}` +
                    ` | Due: ${task.due_at || "N/A"}`
                  );
                })
                .join("\n");
          }
        } else {
          diagnostics.tables.tasks =
            `error_${taskRes.status}`;

          console.error(
            "TASKS READ ERROR:",
            taskRes.error
          );
        }

        // ======================================================
        // SCHEDULES
        // ======================================================

        if (scheduleRes.ok) {
          diagnostics.tables.schedules = "ok";

          rawData.schedules =
            Array.isArray(scheduleRes.data)
              ? scheduleRes.data
              : [];

          if (rawData.schedules.length) {
            contextData.schedules =
              "\n\nSCHEDULES:\n" +
              rawData.schedules
                .map((schedule) => {
                  return (
                    `- ${schedule.title || "Untitled schedule"}` +
                    ` | ${schedule.scheduled_at || "No date"}` +
                    ` | ${schedule.status || "unknown"}`
                  );
                })
                .join("\n");
          }
        } else {
          diagnostics.tables.schedules =
            `error_${scheduleRes.status}`;

          console.error(
            "SCHEDULES READ ERROR:",
            scheduleRes.error
          );
        }

        // ======================================================
        // MEMORIES
        // ======================================================

        if (memoryRes.ok) {
          diagnostics.tables.memories = "ok";

          rawData.memories =
            Array.isArray(memoryRes.data)
              ? memoryRes.data
              : [];

          // -----------------------------------------------
          // Relevance scoring
          // -----------------------------------------------

          const queryWords =
            lastUserQ
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s]/gu, " ")
              .split(/\s+/)
              .filter(
                (word) =>
                  word.length >= 3
              );

          const scored =
            rawData.memories.map(
              (memory) => {
                const content =
                  String(
                    memory.content || ""
                  ).toLowerCase();

                let score = 0;

                for (
                  const word of queryWords
                ) {
                  if (
                    content.includes(word)
                  ) {
                    score += 2;
                  }
                }

                const createdAt =
                  new Date(
                    memory.created_at || 0
                  ).getTime();

                const ageDays =
                  createdAt > 0
                    ? (
                        Date.now() -
                        createdAt
                      ) / 86400000
                    : 9999;

                if (ageDays <= 7) {
                  score += 1;
                }

                if (ageDays <= 30) {
                  score += 0.5;
                }

                return {
                  ...memory,
                  _score: score
                };
              }
            );

          scored.sort(
            (a, b) =>
              b._score - a._score
          );

          const relevant =
            scored
              .filter(
                (memory) =>
                  memory._score > 0
              )
              .slice(0, 20);

          const memoriesToUse =
            relevant.length
              ? relevant
              : rawData.memories.slice(
                  0,
                  10
                );

          if (memoriesToUse.length) {
            contextData.memories =
              "\n\nRELEVANT LONG-TERM MEMORIES:\n" +
              memoriesToUse
                .reverse()
                .map((memory) => {
                  return (
                    `[${memory.role || "memory"}] ` +
                    `${memory.content || ""}`
                  );
                })
                .join("\n");
          }
        } else {
          diagnostics.tables.memories =
            `error_${memoryRes.status}`;

          console.error(
            "MEMORIES READ ERROR:",
            memoryRes.error
          );
        }

        // ======================================================
        // BUSINESS DATA
        // ======================================================

        if (businessRes.ok) {
          diagnostics.tables.business_data =
            "ok";

          rawData.businessData =
            Array.isArray(
              businessRes.data
            )
              ? businessRes.data
              : [];

          if (
            rawData.businessData.length
          ) {
            contextData.businessData =
              "\n\nBUSINESS DATA:\n" +
              rawData.businessData
                .map((item) => {
                  try {
                    return (
                      "- " +
                      JSON.stringify(item)
                    );
                  } catch {
                    return "- Business record";
                  }
                })
                .join("\n");
          }
        } else {
          diagnostics.tables.business_data =
            `error_${businessRes.status}`;

          console.error(
            "BUSINESS DATA READ ERROR:",
            businessRes.error
          );
        }
      } catch (error) {
        console.error(
          "DATABASE CONTEXT ERROR:",
          error
        );
      }
    }

    // ==========================================================
    // 7. WEB SEARCH
    // ==========================================================

    let webContext = "";

    const needsWeb =
      /weather|news|latest|current|today|tomorrow|price|search|who is|what is|score|nba|stock|stocks|exchange rate|usd|php|oil|traffic/i.test(
        lastUserQ
      );

    if (
      needsWeb &&
      tavilyKey
    ) {
      try {
        const response =
          await fetch(
            "https://api.tavily.com/search",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
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

        const data =
          await response.json();

        if (
          response.ok &&
          Array.isArray(
            data.results
          )
        ) {
          webContext =
            "\n\nCURRENT WEB INFORMATION:\n" +
            data.results
              .map((result) => {
                return (
                  `- ${result.title || "Source"}: ` +
                  `${String(
                    result.content || ""
                  ).slice(0, 600)}`
                );
              })
              .join("\n");
        }
      } catch (error) {
        console.error(
          "TAVILY ERROR:",
          error
        );
      }
    }

    // ==========================================================
    // 8. CLIPPY SYSTEM PROMPT
    // ==========================================================

    const systemPrompt = `
You are Clippy.

You are Gelo's long-term AI thinking partner.

You are NOT a generic chatbot.
You are NOT a customer service bot.
You are NOT a Google search box.

You talk naturally with Gelo like a trusted buddy who has been around for a long time.

CURRENT CONTEXT

Philippines timezone:
Asia/Manila

Current local date/time:
${localDateTime}

Current backend timestamp:
${isoNow}

Business ID:
${businessId}

USER

His name is Gelo.

He prefers natural Tagalog-English conversation.

Talk naturally.

Don't translate everything.

Don't force Tagalog.

Don't force English.

Follow the language he naturally uses.

PERSONALITY

Warm.
Calm.
Smart.
Practical.
Curious.
Occasionally funny.
Direct when necessary.

You can joke with Gelo.

You can tease him lightly.

You can say things such as:

"HAHAHA bud 😂"

"Yep."

"Exactly."

"Wait, may problema diyan."

"Okay, now we're cooking. 😂"

But do not repeat the same phrases constantly.

Do not overuse emojis.

Do not sound scripted.

Do not start every response with:

"Certainly"

"Absolutely"

"Of course"

"Great question"

"Sure"

Do not end every response with a question.

This is VERY IMPORTANT.

Only ask a question when missing information is genuinely needed.

Sometimes just answer.

Sometimes react.

Sometimes warn.

Sometimes joke.

Sometimes explain.

Let the conversation breathe.

THINKING PARTNER

Do not blindly agree with Gelo.

If an idea is good, say why.

If something is risky, say so.

If there is a simpler solution, suggest it.

If his plan creates unnecessary complexity, tell him.

Do not argue just to sound intelligent.

The goal is better decisions.

DATA

Clippy is connected to Supabase.

Supabase is the persistent data layer.

Possible data includes:

memories
tasks
schedules
business data
messages
people
projects
sales
inventory
expenses
documents
and other structured information.

Use available database context when relevant.

Never invent database records.

Never claim a database operation succeeded unless the backend confirms it.

MEMORY

Important information about Gelo should be considered for long-term memory.

Examples:

preferences
goals
plans
important decisions
people
relationships
work information
projects
personal facts
important experiences

Do not treat every casual sentence as permanent memory.

The backend decides whether a memory action should actually be saved.

DATABASE ACTIONS

You have the ability to request structured database actions.

When Gelo gives information that clearly belongs in a database table, create an action.

Available action types:

memory
task
schedule
business_data

Examples:

"Remember that I prefer simple UI."

→ memory

"Task: check inventory tomorrow."

→ task

"Opening shift ako tomorrow at 11 AM."

→ schedule

"Store target is 116228 per day."

→ business_data

"Save this: Rico is fry station certified."

→ memory or business_data depending on context.

IMPORTANT:

Only create an action when the user's message actually contains information worth storing.

Do not create actions for ordinary conversation.

DO NOT claim the action was saved.

The backend will execute the action and tell the frontend whether it succeeded.

ACTION FORMAT

Your response MUST be valid JSON.

Do not use markdown fences.

Return exactly this structure:

{
  "reply": "natural response to Gelo",
  "actions": [
    {
      "type": "memory",
      "data": {
        "content": "information to remember"
      }
    }
  ]
}

Available action types:

memory

{
  "type": "memory",
  "data": {
    "content": "..."
  }
}

task

{
  "type": "task",
  "data": {
    "title": "...",
    "due_at": "ISO timestamp or null"
  }
}

schedule

{
  "type": "schedule",
  "data": {
    "title": "...",
    "scheduled_at": "ISO timestamp",
    "status": "pending"
  }
}

business_data

{
  "type": "business_data",
  "data": {
    "name": "..."
  }
}

If there are no database actions:

"actions": []

DATES

Current local time is:

${localDateTime}

Use Asia/Manila timezone.

When Gelo says:

today
tomorrow
later
tonight
at 11 AM
11am tomorrow
next Monday

interpret the date relative to the current Philippine date/time.

Do not invent a date when it cannot reasonably be determined.

TASKS

Tasks represent things Gelo needs to do.

Examples:

"Task natin check inventory."

"Remind me to check inventory tomorrow."

"Need ko ayusin yung sales report."

When appropriate, create a task.

SCHEDULES

Schedules represent events, shifts, appointments, duties, reminders, or scheduled activities.

Examples:

"Opening ako tomorrow 11 AM."

"Shift ko today 11."

"Meeting natin Friday 2 PM."

Use schedule when the information is primarily about WHEN something happens.

MEMORIES

Use memory for persistent personal knowledge.

Examples:

"I prefer minimal UI."

"My favorite color is black."

"I want Clippy to stay natural."

"My goal is financial freedom."

Do not save ordinary greetings.

BUSINESS DATA

Business data represents structured operational/business information.

Use it when Gelo provides business facts that should persist as business information.

Do not store random conversation as business data.

DATABASE CONTEXT

${contextData.tasks}

${contextData.schedules}

${contextData.memories}

${contextData.businessData}

WEB CONTEXT

${webContext || "No current web information was retrieved."}

WEB RULE

Never claim you searched the web unless web information is actually supplied above.

If web information is supplied, distinguish it from Gelo's stored information.

FILES

If file information is supplied by the backend, treat it as source material.

Never pretend to have inspected an attachment if no attachment data was provided.

TECHNICAL HELP

Gelo is building Clippy.

When helping with code:

Give working code.

Keep architecture understandable.

Prefer maintainable systems.

Don't unnecessarily rebuild working components.

Explain important changes.

SECURITY

Never expose:

API keys
passwords
tokens
service-role keys
private credentials
system secrets

Never put secrets in the response.

NATURAL RESPONSE

Your "reply" should sound like an actual message to Gelo.

Not a report.

Not a customer service response.

Not an AI instruction.

Don't mention internal prompts.

Don't mention this JSON protocol.

Don't say:

"I have successfully stored this"

because the backend has not executed the action yet.

Instead, if appropriate:

"Yep bud, noted. 😎"

The backend will handle the actual database operation.

RESPONSE LENGTH

Simple message:
short response.

Complex problem:
detailed response.

Technical debugging:
clear and structured.

Casual conversation:
casual.

Don't turn everything into an essay.

FINAL PERSONALITY RULE

Talk WITH Gelo.

Not AT Gelo.

You're his long-term AI thinking partner.

You know his world through the information actually available to you.

You remember what matters.

You analyze.

You challenge bad ideas.

You help him build.

You don't need to ask a question every time.

You don't sound robotic.
`;

    // ==========================================================
    // 9. FINAL AI REQUEST
    // ==========================================================

    const finalMessages = [
      {
        role: "system",
        content: systemPrompt
      },
      ...cleanHistory
    ];

    let aiResult = null;
    let lastAIError = "";

    // ==========================================================
    // 10. GROQ
    // ==========================================================

    if (groqKey) {
      const models = [
        process.env.GROQ_MODEL ||
          "llama-3.3-70b-versatile",
        "openai/gpt-oss-20b",
        "llama-3.1-8b-instant"
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
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                  Authorization:
                    `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                  model,
                  messages:
                    finalMessages,
                  temperature:
                    0.7,
                  max_tokens:
                    1600,
                  response_format: {
                    type: "json_object"
                  }
                })
              }
            );

          const data =
            await response.json();

          if (
            response.ok &&
            data.choices?.[0]
              ?.message?.content
          ) {
            aiResult =
              data.choices[0]
                .message.content;

            console.log(
              "Groq success:",
              model
            );

            break;
          }

          lastAIError =
            data?.error?.message ||
            `Groq HTTP ${response.status}`;
        } catch (error) {
          lastAIError =
            error?.message ||
            "Groq request failed";

          console.error(
            "Groq error:",
            error
          );
        }
      }
    }

    // ==========================================================
    // 11. OPENAI FALLBACK
    // ==========================================================

    if (
      !aiResult &&
      openaiKey
    ) {
      try {
        const response =
          await fetch(
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
                messages:
                  finalMessages,
                temperature:
                  0.7,
                max_tokens:
                  1600,
                response_format: {
                  type: "json_object"
                }
              })
            }
          );

        const data =
          await response.json();

        if (
          response.ok &&
          data.choices?.[0]
            ?.message?.content
        ) {
          aiResult =
            data.choices[0]
              .message.content;
        } else {
          lastAIError =
            data?.error?.message ||
            `OpenAI HTTP ${response.status}`;
        }
      } catch (error) {
        lastAIError =
          error?.message ||
          "OpenAI request failed";
      }
    }

    // ==========================================================
    // 12. AI FAILURE
    // ==========================================================

    if (!aiResult) {
      return res.status(200).json({
        reply:
          "Buddy, nag-fail yung AI request. Check natin yung Vercel function logs.",
        diagnostics: {
          aiError: lastAIError,
          supabase:
            diagnostics
        }
      });
    }

    // ==========================================================
    // 13. PARSE AI JSON
    // ==========================================================

    let parsedAI;

    try {
      parsedAI =
        JSON.parse(aiResult);
    } catch (error) {
      console.error(
        "AI JSON PARSE ERROR:",
        error,
        aiResult
      );

      /*
        Fallback:
        If the model somehow returned normal text,
        keep it instead of crashing.
      */

      parsedAI = {
        reply: String(
          aiResult
        ),
        actions: []
      };
    }

    let reply =
      typeof parsedAI.reply ===
      "string"
        ? parsedAI.reply.trim()
        : "";

    let actions =
      Array.isArray(
        parsedAI.actions
      )
        ? parsedAI.actions
        : [];

    if (!reply) {
      reply =
        "Yep bud. Nakuha ko.";
    }

    // ==========================================================
    // 14. DATABASE ACTION EXECUTION
    // ==========================================================

    const actionResults = [];

    if (
      supabaseUrl &&
      supabaseKey &&
      actions.length
    ) {
      for (
        const action of actions
      ) {
        if (
          !action ||
          !action.type ||
          !action.data
        ) {
          continue;
        }

        // ======================================================
        // MEMORY
        // ======================================================

        if (
          action.type ===
          "memory"
        ) {
          const content =
            String(
              action.data
                .content || ""
            ).trim();

          if (!content) {
            continue;
          }

          const result =
            await supabaseInsert(
              "memories",
              {
                business_id:
                  businessId,
                content:
                  content.slice(
                    0,
                    2000
                  ),
                role: "user"
              }
            );

          const success =
            result.ok;

          diagnostics.actions.push(
            {
              type: "memory",
              success,
              status:
                result.status
            }
          );

          diagnostics.tables.memories =
            success
              ? "ok_write"
              : diagnostics
                  .tables
                  .memories;

          actionResults.push({
            type: "memory",
            success
          });

          continue;
        }

        // ======================================================
        // TASK
        // ======================================================

        if (
          action.type ===
          "task"
        ) {
          const title =
            String(
              action.data
                .title || ""
            ).trim();

          if (!title) {
            continue;
          }

          const payload = {
            business_id:
              businessId,

            title:
              title.slice(
                0,
                500
              ),

            due_at:
              action.data
                .due_at ||
              null,

            is_done:
              false
          };

          let result =
            await supabaseInsert(
              "tasks",
              payload
            );

          /*
            If your tasks table doesn't
            have due_at, retry without it.
          */

          if (
            !result.ok &&
            /due_at/i.test(
              result.error ||
                ""
            )
          ) {
            const fallback =
              {
                business_id:
                  businessId,

                title:
                  title.slice(
                    0,
                    500
                  ),

                is_done:
                  false
              };

            result =
              await supabaseInsert(
                "tasks",
                fallback
              );
          }

          const success =
            result.ok;

          diagnostics.actions.push(
            {
              type: "task",
              success,
              status:
                result.status
            }
          );

          if (success) {
            diagnostics.tables.tasks =
              "ok_write";
          }

          actionResults.push({
            type: "task",
            success
          });

          continue;
        }

        // ======================================================
        // SCHEDULE
        // ======================================================

        if (
          action.type ===
          "schedule"
        ) {
          const title =
            String(
              action.data
                .title || ""
            ).trim();

          const scheduledAt =
            action.data
              .scheduled_at;

          if (
            !title ||
            !scheduledAt
          ) {
            continue;
          }

          const payload = {
            business_id:
              businessId,

            title:
              title.slice(
                0,
                500
              ),

            scheduled_at:
              scheduledAt,

            status:
              action.data
                .status ||
              "pending"
          };

          let result =
            await supabaseInsert(
              "schedules",
              payload
            );

          /*
            If status isn't present
            in your table, retry.
          */

          if (
            !result.ok &&
            /status/i.test(
              result.error ||
                ""
            )
          ) {
            result =
              await supabaseInsert(
                "schedules",
                {
                  business_id:
                    businessId,

                  title:
                    title.slice(
                      0,
                      500
                    ),

                  scheduled_at:
                    scheduledAt
                }
              );
          }

          const success =
            result.ok;

          diagnostics.actions.push(
            {
              type: "schedule",
              success,
              status:
                result.status
            }
          );

          if (success) {
            diagnostics.tables.schedules =
              "ok_write";
          }

          actionResults.push({
            type: "schedule",
            success
          });

          continue;
        }

        // ======================================================
        // BUSINESS DATA
        // ======================================================

        if (
          action.type ===
          "business_data"
        ) {
          const name =
            String(
              action.data
                .name || ""
            ).trim();

          if (!name) {
            continue;
          }

          /*
            We first try with business_id.
            If your table doesn't contain
            business_id, retry with name only.
          */

          let result =
            await supabaseInsert(
              "business_data",
              {
                business_id:
                  businessId,

                name:
                  name.slice(
                    0,
                    1000
                  )
              }
            );

          if (
            !result.ok &&
            /business_id/i.test(
              result.error ||
                ""
            )
          ) {
            result =
              await supabaseInsert(
                "business_data",
                {
                  name:
                    name.slice(
                      0,
                      1000
                    )
                }
              );
          }

          const success =
            result.ok;

          diagnostics.actions.push(
            {
              type:
                "business_data",
              success,
              status:
                result.status
            }
          );

          if (success) {
            diagnostics.tables.business_data =
              "ok_write";
          }

          actionResults.push({
            type:
              "business_data",
            success
          });

          continue;
        }
      }
    }

    // ==========================================================
    // 15. CHAT MESSAGE SAVE
    // ==========================================================

    if (
      supabaseUrl &&
      supabaseKey
    ) {
      try {
        const messageResult =
          await supabaseInsert(
            "messages",
            [
              {
                business_id:
                  businessId,

                content:
                  lastUserQ.slice(
                    0,
                    2000
                  ),

                role: "user"
              },

              {
                business_id:
                  businessId,

                content:
                  reply.slice(
                    0,
                    4000
                  ),

                role: "assistant"
              }
            ]
          );

        if (
          messageResult.ok
        ) {
          diagnostics.tables.messages =
            "ok_write";
        } else {
          diagnostics.tables.messages =
            `error_${messageResult.status}`;

          console.error(
            "MESSAGE SAVE FAILED:",
            messageResult.error
          );
        }
      } catch (error) {
        diagnostics.tables.messages =
          "exception";

        console.error(
          "MESSAGE SAVE ERROR:",
          error
        );
      }
    }

    // ==========================================================
    // 16. DATABASE RESULT FEEDBACK
    // ==========================================================

    /*
      We only add a database status message
      when an action was actually requested.

      This prevents Clippy from saying "saved"
      when Supabase rejected the write.
    */

    if (
      actionResults.length
    ) {
      const failed =
        actionResults.filter(
          (result) =>
            !result.success
        );

      const succeeded =
        actionResults.filter(
          (result) =>
            result.success
        );

      if (
        failed.length &&
        !succeeded.length
      ) {
        reply +=
          "\n\nHindi ko na-save sa database yung input na 'yan. Check natin yung table/schema connection.";
      } else if (
        failed.length
      ) {
        reply +=
          "\n\nMay part na hindi na-save sa database, though some data went through. May table/schema issue tayong kailangan ayusin.";
      }
    }

    // ==========================================================
    // 17. CLEAN RESPONSE
    // ==========================================================

    reply = String(
      reply
    )
      .replace(
        /```[\s\S]*?```/g,
        ""
      )
      .replace(
        /^["']|["']$/g,
        ""
      )
      .trim();

    // ==========================================================
    // 18. FINAL RESPONSE
    // ==========================================================

    return res.status(200).json({
      reply,

      diagnostics: {
        database:
          diagnostics
            .supabaseConfigured
            ? "connected"
            : "not_configured",

        tables:
          diagnostics.tables,

        actions:
          diagnostics.actions
      }
    });
  } catch (error) {
    // ==========================================================
    // GLOBAL ERROR HANDLER
    // ==========================================================

    console.error(
      "CLIPPY API FATAL ERROR:",
      error
    );

    return res.status(500).json({
      reply:
        "Buddy, may server error tayo. Check natin yung Vercel function logs.",
      error:
        error?.message ||
        "Unknown server error"
    });
  }
}
