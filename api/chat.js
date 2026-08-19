export default async function handler(req, res) {

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

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {

      return res.status(400).json({

        error: "messages required"

      });

    }

    // =========================

    // API KEYS

    // =========================

    const groqKey = (process.env.GROQ_API_KEY || "").trim();

    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();

    const tavilyKey = (process.env.TAVILY_API_KEY || "").trim();

    // SUPABASE

    const supabaseUrl = (process.env.SUPABASE_URL || "").trim();

    const supabaseKey = (process.env.SUPABASE_ANON_KEY || "").trim();

    if (!groqKey && !openaiKey) {

      return res.status(200).json({

        reply: "No AI key! Add GROQ_API_KEY."

      });

    }

    // =========================

    // CURRENT TIME

    // =========================

    const now = new Date().toLocaleString("en-PH", {

      timeZone: "Asia/Manila"

    });

    // =========================

    // CLIPPY PERSONALITY

    // =========================

    let systemPrompt = `You are Clippy — Gelo's AI OS.

Date: ${now}.

Be helpful, concise, conversational, practical, and friendly.

Use a natural buddy tone.

You have web search access when needed.

Only say "Good progress today buddy. Let's continue later."

when the user says bye or goodnight.`;

    // =========================

    // CLEAN CHAT HISTORY

    // =========================

    const cleanHistory = messages

      .filter((m) => m.role !== "system")

      .slice(-20);

    const lastUserMessage =

      cleanHistory

        .filter((m) => m.role === "user")

        .slice(-1)[0]?.content || "";

    // =========================

    // SAVE MESSAGE TO SUPABASE

    // =========================

    if (lastUserMessage && supabaseUrl && supabaseKey) {

      try {

        const response = await fetch(

          `${supabaseUrl}/rest/v1/memories`,

          {

            method: "POST",

            headers: {

              "Content-Type": "application/json",

              "apikey": supabaseKey,

              "Authorization": `Bearer ${supabaseKey}`,

              "Prefer": "return=minimal"

            },

            body: JSON.stringify({

              category: "conversation",

              content: lastUserMessage

            })

          }

        );

        if (!response.ok) {

          const errorText = await response.text();

          console.log(

            "Supabase save failed:",

            errorText

          );

        } else {

          console.log(

            "Clippy memory saved successfully."

          );

        }

      } catch (error) {

        console.log(

          "Supabase connection error:",

          error.message

        );

      }

    } else {

      console.log(

        "Supabase variables are missing."

      );

    }

    // =========================

    // TAVILY WEB SEARCH

    // =========================

    let webContext = "";

    const needsWeb =

      /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock|nba|weather in/i

        .test(lastUserMessage);

    if (needsWeb && tavilyKey) {

      try {

        const searchResponse = await fetch(

          "https://api.tavily.com/search",

          {

            method: "POST",

            headers: {

              "Content-Type": "application/json"

            },

            body: JSON.stringify({

              api_key: tavilyKey,

              query: lastUserMessage,

              max_results: 5,

              search_depth: "basic",

              include_answer: true

            })

          }

        );

        const searchData =

          await searchResponse.json();

        if (searchData.results?.length) {

          webContext = `

WEB SEARCH RESULTS:

${searchData.results

  .map(

    (result) =>

      `- ${result.title}: ${result.content.slice(

        0,

        350

      )} [${result.url}]`

  )

  .join("\n")}

Use these results when answering the user.`;

        }

      } catch (error) {

        console.log(

          "Tavily error:",

          error.message

        );

      }

    }

    // =========================

    // FINAL AI MESSAGE

    // =========================

    const finalMessages = [

      {

        role: "system",

        content: systemPrompt + webContext

      },

      ...cleanHistory

    ];

    let reply = null;

    let lastError = "";

    // =========================

    // GROQ

    // =========================

    if 
