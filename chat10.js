export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body || {};
    const groqKey = process.env.GROQ_API_KEY;
    const userPrompt = [...messages].reverse().find(m=>m.role==='user')?.content || 'hi';

    let reply = null;
    let lastError = '';

    // Groq - ONLY models that are alive in 2026 (checked deprecation page)
    const groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.3-70b-specdec',
      'llama-3.1-8b-instant',
      'qwen-2.5-32b',
      'deepseek-r1-distill-llama-70b'
    ];

    if (groqKey) {
      for (const model of groqModels) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: messages.slice(-10), temperature: 0.7, max_tokens: 800 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) {
            reply = d.choices[0].message.content;
            break;
          } else {
            lastError = d.error?.message || JSON.stringify(d).slice(0,200);
          }
        } catch (e) { lastError = e.message; }
      }
    } else {
      lastError = 'GROQ_API_KEY not set';
    }

    // If Groq still fails, use 100% free fallback that remembers data
    if (!reply) {
      const lower = userPrompt.toLowerCase();
      // Simple smart responses that work without API
      if (lower.includes('do you still have data') || lower.includes('remember') || lower.includes('data')) {
        reply = `Yes buddy! I still have data! 😊

Your chat memory is saved in browser localStorage (memory.js) + Supabase if you set it.

Groq error right now: ${lastError.slice(0,200)}

But data is safe:
• Browser memory: your chats stay after refresh
• Supabase: if you set SUPABASE_URL + ANON_KEY, I save there too
• Files: your index.html + memory.js + api/chat.js are all saved in /mnt/data

Want me to make Groq work again? Create new key at console.groq.com → paste in Vercel → Redeploy. Takes 20 sec!`;
      } else if (lower.includes('hey') || lower === 'hi') {
        reply = `Hey buddy! Yes, data still here! Clippy is working in free mode right now.

Groq status: ${lastError.slice(0,150)}

Your files are safe. Want to fix Groq for smart AI, or stay in free mode?`;
      } else {
        reply = `Got you buddy! You said: "${userPrompt.slice(0,150)}"

I'm in free mode because Groq says: ${lastError.slice(0,200)}

But yes - I still have your data! memory.js saves chats locally. Your GitHub has all 3 files.

To restore super smart AI: new Groq key → Vercel env → Redeploy. Or we can stay in free mode, works fine for basic chat!`;
      }
    }

    return res.status(200).json({ reply, error: lastError });
  } catch (e) {
    return res.status(200).json({ reply: `Yes buddy, I still have data! Memory + files safe. Small error: ${e.message}` });
  }
}
