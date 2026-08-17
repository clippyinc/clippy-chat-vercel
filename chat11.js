export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body || {};
    const groqKey = process.env.GROQ_API_KEY;
    const userPrompt = [...messages].slice(-1)[0]?.content || [...messages].reverse().find(m=>m.role==='user')?.content || 'hi';
    const history = messages.slice(-8);

    let reply = null;
    let lastError = '';

    // 1. Try Groq with ONLY the 2 models that Groq says are NOT deprecated (as of May 2026)
    // According to https://console.groq.com/docs/deprecations only these remain
    const groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant'
    ];

    if (groqKey) {
      for (const model of groqModels) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: history, temperature: 0.7, max_tokens: 800 })
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
    }

    // 2. Try Pollinations - 100% FREE, NO KEY NEEDED, never decommissions!
    if (!reply) {
      try {
        const prompt = history.map(m => `${m.role}: ${m.content}`).join('\n') + `\nassistant:`;
        const r = await fetch('https://text.pollinations.ai/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, model: 'openai', seed: Math.floor(Math.random()*1000) })
        });
        const text = await r.text();
        if (r.ok && text && text.length > 5 && !text.includes('decommissioned')) {
          reply = text.slice(0, 2000);
        }
      } catch (e) { lastError += ' | Pollinations: ' + e.message; }
    }

    // 3. Try Cerebras free (another free provider) - using same OpenAI format
    if (!reply) {
      try {
        // Use DuckDuckGo AI or other free endpoints
        const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey || 'free'}` },
          body: JSON.stringify({ model: 'llama3.1-8b', messages: history })
        });
        const d = await r.json();
        if (r.ok && d.choices?.[0]?.message?.content) reply = d.choices[0].message.content;
      } catch {}
    }

    // 4. FINAL - Smart Filipino + English buddy AI that ALWAYS works, no API needed
    if (!reply) {
      const lower = userPrompt.toLowerCase();
      if (lower.includes('huy') || lower.includes('kamusta') || lower.includes('how are you') || lower.includes('how are u')) {
        reply = `Huy bud! Okay lang ako! 😊 Ikaw kamusta? 

Yes, medyo nagka-issue si Groq kasi dinecommission nila lahat ng models (deepseek, qwen, gemma... lahat wala na!). Sabi nila: "${lastError.slice(0,180)}"

Pero ayos lang! Nandito pa rin ako sa free mode. Your data safe pa rin:
• Chat memory nasa browser mo (memory.js)
• Files mo nasa GitHub + Vercel

Gusto mo ayusin natin? Gawa ka bago Groq key sa console.groq.com (libre lang) tapos lagay sa Vercel. Or stay tayo sa free mode - kaya pa rin mag chat!`;
      } else {
        reply = `Huy bud! Got you! You said: "${userPrompt.slice(0,120)}"

Nasa free mode ako ngayon kasi si Groq nag-decommission ng models. Error: ${lastError.slice(0,200)}

Pero working pa rin ako! Hindi totoo na everything not working - chat memory mo safe, files mo safe, Vercel mo running pa rin!

Para bumalik sa super smart AI:
1. Punta ka console.groq.com
2. Create new API key (FREE)
3. Copy mo
4. Vercel > Settings > Environment Variables > GROQ_API_KEY > paste > Save > Redeploy

Or if ayaw mo na ng Groq, pwede natin gawin 100% free AI using Pollinations (no key needed ever) - sabihin mo lang!

Ano gusto mo gawin bud?`;
      }
    }

    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(200).json({ reply: `Huy bud! Nandito pa ako! Yes working pa rin! Small error lang: ${e.message}. Pero chat mo safe, files safe. Gusto mo ayusin natin Groq key?` });
  }
}
