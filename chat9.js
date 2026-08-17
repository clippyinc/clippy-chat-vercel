export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body || {};
    const groqKey = process.env.GROQ_API_KEY;

    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    let reply = null;
    let usedModel = null;
    let lastError = '';

    const userPrompt = [...messages].reverse().find(m=>m.role==='user')?.content || 'hi';

    // 1. Try Groq if key exists - with CURRENT valid models (Jan 2026)
    const groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'llama3-8b-8192',
      'gemma2-9b-it'
    ];

    if (groqKey) {
      for (const model of groqModels) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: messages.slice(-10), temperature: 0.7, max_tokens: 1000 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) {
            reply = d.choices[0].message.content;
            usedModel = model;
            break;
          } else {
            lastError = d.error?.message || JSON.stringify(d).slice(0,200);
          }
        } catch (e) { lastError = e.message; }
      }
    }

    // 2. Try Hugging Face free inference (no key needed) - fallback
    if (!reply) {
      try {
        const hfModels = ['HuggingFaceH4/zephyr-7b-beta', 'mistralai/Mistral-7B-Instruct-v0.2'];
        for (const hfModel of hfModels) {
          try {
            const r = await fetch(`https://api-inference.huggingface.co/models/${hfModel}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inputs: userPrompt, parameters: { max_new_tokens: 400, temperature: 0.7 } })
            });
            const d = await r.json();
            if (r.ok && (d[0]?.generated_text || d.generated_text)) {
              const txt = d[0]?.generated_text || d.generated_text;
              reply = txt.replace(userPrompt, '').trim() || txt;
              usedModel = hfModel + ' (free, no key)';
              break;
            }
          } catch {}
        }
      } catch {}
    }

    // 3. FINAL fallback - works 100% without any API key - smart template
    if (!reply) {
      const lower = userPrompt.toLowerCase();
      if (lower.includes('hey') || lower.includes('hi') || lower === 'hey buddy') {
        reply = `Hey buddy! I'm Clippy 👋 I'm working! Your Groq key seems to have an issue: ${lastError.slice(0,150)}. 

Quick fix:
1. Go to console.groq.com → API Keys → Create new key
2. Copy it
3. Vercel → your project → Settings → Environment Variables → GROQ_API_KEY → paste new key → Save → Redeploy

But I'm still here chatting in free mode! How can I help you today?`;
      } else if (lower.includes('who are you') || lower.includes('what are you')) {
        reply = `I'm Clippy - your friendly AI assistant built by you! I'm running on your Vercel deployment with memory, file attachments, and chat history. 

Your Groq API had error: ${lastError.slice(0,100)}
That's why I'm in fallback mode right now, but I still work!`;
      } else {
        reply = `Got it buddy! You said: "${userPrompt.slice(0,200)}"

I'm in free fallback mode right now because Groq returned: ${lastError.slice(0,150)}

This usually means:
• Groq API key is invalid/expired - create new one at console.groq.com
• Or you hit rate limit - wait 1 minute

But I can still help! Tell me what you need and I'll do my best in free mode. If you fix the Groq key and redeploy, I'll be super smart again with llama-3.3-70b!`;
      }
      usedModel = 'fallback-free-no-key';
    }

    return res.status(200).json({ reply, model: usedModel, groq_error: lastError });
  } catch (e) {
    return res.status(500).json({ error: e.message, reply: "Hey buddy! I'm Clippy - had a small hiccup but I'm back! What do you need?" });
  }
}
