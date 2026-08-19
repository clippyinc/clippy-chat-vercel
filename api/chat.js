export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {

    return res.status(405).json({ error: 'Method not allowed' });

  }

  try {

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {

      return res.status(400).json({ error: 'messages required' });

    }

    // =========================

    // API KEYS

    // =========================

    const groqKey = (process.env.GROQ_API_KEY || '').trim();

    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();

    const tavilyKey = (process.env.TAVILY_API_KEY || '').trim();

    // =========================

    // SUPABASE

    // =========================

    const supabaseUrl = (process.env.SUPABASE_URL || '').trim();

    const supabaseKey = (process.env.SUPABASE_ANON_KEY || '').trim();

    if (!groqKey && !openaiKey) {

      return res.status(200).json({

        reply: 'No AI key! Add GROQ_API_KEY or OPENAI_API_KEY.'

      });

    }

    // =========================

    // TIME

    // =========================

    const now = new Date().toLocaleString("en-PH", {

      timeZone: "Asia/Manila"

    });

    // =========================

    // SYSTEM PROMPT

    // =========================

    let systemPrompt = `You are Clippy — Gelo's AI OS from Marilao, PH.

Date: ${now}.

Be helpful, concise, conversational, practical, and use a friendly buddy tone.

You have web search access when needed.

Only say "Good progress today buddy. Let's continue later."

when user says bye/goodnight.`;

    // =========================

    // CLEAN HISTORY

    // =========================

    const cleanHistory = messages

      .filter(m => m.role !== 'system')

      .slice(-20);

    const lastUserQ =

      cleanHistory

        .filter(m => m.role === 'user')

        .slice(-1)[0]?.content || '';

    // =========================

    // SAVE USER MESSAGE

    // =========================

    if (lastUserQ && supabaseUrl && supabaseKey) {

      try {

        const memoryResponse = await fetch(

          `${supabaseUrl}/rest/v1/memories`,

          {

            method: 'POST',

            headers: {

              'Content-Type': 'application/json',

              'apikey': supabaseKey,

              'Authorization': `Bearer ${supabaseKey}`,

              'Prefer': 'return=minimal'

            },

            body: JSON.stringify({

              category: 'conversation',

              content: lastUserQ

            })

          }

        );

        if (!memoryResponse.ok) {

          const memoryError = await memoryResponse.text();

          console.log('Supabase memory save failed:', memoryError);

        } else {

          console.log('Supabase memory saved successfully.');

        }

      } catch (e) {

        console.log('Supabase connection failed:', e.message);

      }

    } else {

      console.log('Supabase variables missing.');

    }

    // =========================

    // WEB SEARCH

    // =========================

    let webContext = '';

    const needsWeb =

      /news|price|weather|today|current|latest|search|who is|what is.*2025|2026|score|stock|nba|weather in/i

        .test(lastUserQ);

    if (needsWeb && tavilyKey) {

      try {

        const sRes = await fetch(

          'https://api.tavily.com/search',

          {

            method: 'POST',

            headers: {

              'Content-Type': 'application/json'

            },

            body: JSON.stringify({

              api_key: tavilyKey,

              query: lastUserQ,

              max_results: 5,

              search_depth: 'basic',

              include_answer: true

            })

          }

        );

        const sData = await sRes.json();

        if (sData.results?.length) {

          webContext = `

WEB SEARCH RESULTS for "${lastUserQ}":

${sData.results

  .map(

    r =>

      `- ${r.title}: ${r.content.slice(0, 350)} [${r.url}]`

  )

  .join('\n')}

Answer using these results and cite sources where appropriate.`;

        }

      } catch (e) {

        console.log('Tavily fail:', e.message);

      }

    }

    // =========================

    // FINAL AI MESSAGES

    // =========================

    const finalMessages = [

      {

        role: 'system',

        content: systemPrompt + webContext

      },

      ...cleanHistory

    ];

    let reply = null;

    let lastError = '';

    // =========================

    // GROQ

    // =========================

    if (groqKey) {

      const models = [

        'llama-3.1-8b-instant',

        'gemma2-9b-it',

        'openai/gpt-oss-20b',

        'llama-3.3-70b-versatile'

      ];

      for (const model of models) {

     
