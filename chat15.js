// api/chat.js (Vercel Serverless Function) - Clippy with Memory + Free AI fallbacks
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    
    // Support BOTH formats:
    // New: { message, history } from your code
    // Old: { messages: [...] } from your index.html
    let userMessage = body.message || '';
    let history = body.history || [];
    
    if (!userMessage && body.messages) {
      // Old format conversion
      const msgs = body.messages || [];
      // Last user message is the current one
      const reversed = [...msgs].reverse();
      const lastUser = reversed.find(m => m.role === 'user');
      userMessage = lastUser?.content || msgs[msgs.length-1]?.content || '';
      // History = all before last
      history = msgs.slice(0, -1);
      // If history contains system prompt from frontend, keep it
      if (msgs[0]?.role === 'system') {
        history = msgs.slice(0, -1);
      }
    }

    if (!userMessage) userMessage = 'hi';

    // ===== MEMORY SEARCH =====
    const memory = await searchMemory(userMessage);

    // ===== SYSTEM PROMPT =====
    const systemPrompt = `
You are Clippy.

Personality:
- Friendly, use "buddy" naturally but not overdo
- Conversational, helpful
- Long-term thinking partner
- You remember user's business (restaurant management) and goals (financial freedom, building Clippy)
- Short, clear replies (your frontend has small bubbles)

Known memory:
${memory}

Current context:
- User is in Philippines (Marilao/Valenzuela)
- Deployment dept work - he copy-pastes code to GitHub
- Building Clippy PWA -> Phase 2 APK overlay
`;

    let reply = null;

    // ===== 1. OPENAI (if key exists) - Your new code =====
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && !reply) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...history.slice(-10),
              { role: "user", content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 1000
          })
        });
        const data = await response.json();
        if (response.ok && data.choices?.[0]?.message?.content) {
          reply = data.choices[0].message.content;
        } else {
          console.log('OpenAI error:', JSON.stringify(data).slice(0,500));
        }
      } catch (e) {
        console.log('OpenAI fetch error:', e.message);
      }
    }

    // ===== 2. GROQ (FREE, no credit card) =====
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && !reply) {
      for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model, 
              messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-8), { role: 'user', content: userMessage }], 
              temperature: 0.7, 
              max_tokens: 1000 
            })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
        } catch {}
      }
    }

    // ===== 3. POLLINATIONS (100% FREE, NO KEY - from your screenshot) =====
    if (!reply) {
      try {
        const r = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai',
            messages: [
              { role: 'system', content: systemPrompt },
              ...history.slice(-8).map(m => ({ role: m.role, content: String(m.content).slice(0,2000) })),
              { role: 'user', content: String(userMessage).slice(0,2000) }
            ],
            seed: Math.floor(Math.random()*100000)
          })
        });
        if (r.ok) {
          const text = await r.text();
          try {
            const d = JSON.parse(text);
            if (d.choices?.[0]?.message?.content) reply = d.choices[0].message.content;
          } catch {
            if (text.length > 10 && !text.includes('<!DOCTYPE')) reply = text.slice(0,2000);
          }
        }
        if (!reply) {
          const encoded = encodeURIComponent(String(userMessage).slice(0,500));
          const r2 = await fetch(`https://text.pollinations.ai/${encoded}?model=openai`, { headers: { 'Cache-Control': 'no-cache' } });
          const txt2 = await r2.text();
          if (r2.ok && txt2.length > 10 && !txt2.includes('<!DOCTYPE')) reply = txt2.slice(0,2000);
        }
      } catch (e) {
        console.log('Pollinations error:', e.message);
      }
    }

    // ===== 4. FINAL FALLBACK =====
    if (!reply) {
      reply = `Huy buddy! Clippy is online! 🚀\n\nYou said: "${String(userMessage).slice(0,100)}"\n\nI'm running on free AI - add GROQ_API_KEY or OPENAI_API_KEY in Vercel env for stronger brain!`;
    }

    // ===== SAVE MEMORY =====
    await saveConversation(userMessage, reply);

    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(200).json({ reply: `Sorry buddy, error: ${err.message} - but I'm still here!` });
  }
}

// =====================================================
// MEMORY FUNCTIONS
// Replace with Supabase later
// =====================================================
async function searchMemory(query) {
  // TODO: Replace with vector search later (Supabase/pgvector)
  // For now static memory like you wrote
  return `
User likes financial freedom.
User manages a restaurant / small business.
User is building Clippy (Phase 1 PWA done, Phase 2 APK overlay).
User is deployment dept - copy-paste to GitHub.
User location: Marilao / Valenzuela / Calbiga.
User learning: website files (.html, .js, .json) and APK structure.
Last query: ${String(query).slice(0,200)}
`;
}

async function saveConversation(user, assistant) {
  console.log("Saving conversation...", user.slice(0,50), "->", assistant.slice(0,50));
  // TODO: Supabase insert later
  // await supabase.from('memories').insert({ user, assistant })
}
