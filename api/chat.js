// api/chat.js - FIXED Aug 18 2026 - Groq retired Llama 3.1 8B on Aug 16, use new models
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    let userMessage = body.message || '';
    let history = body.history || [];
    if (!userMessage && body.messages) {
      const msgs = body.messages || [];
      const reversed = [...msgs].reverse();
      const lastUser = reversed.find(m => m.role === 'user');
      userMessage = lastUser?.content || msgs[msgs.length-1]?.content || 'hi';
      history = msgs.slice(0, -1);
    }
    if (!userMessage) userMessage = 'hi';

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "full", timeStyle: "short" });
    const memory = `User is Gelo Cabornay (julythesecond on FB), lives Marilao PH, manages restaurant/small business, goal financial freedom. Building Clippy PWA->APK overlay (Phase 1 PWA done, Phase 2 APK dream). Current date/time Manila: ${now}.`;
    const systemPrompt = `You are Clippy, a custom PWA chat assistant built by Gelo, NOT Microsoft Office paperclip. You are friendly, you call user buddy sometimes. You live at clippy-chat-vercel.vercel.app. Your emoji is 🤖📎. Memory: ${memory}. Today is ${now}. Remember conversation history well - you have unlimited slice now!`;

    let reply = null;
    let lastError = '';
    const groqKey = process.env.GROQ_API_KEY;
    console.log("GROQ KEY EXISTS?", !!groqKey);

    if (groqKey) {
      // NEW ACTIVE MODELS as of Aug 18 2026 - Llama 3.1 8B retired Aug 16!
      const modelsToTry = [
        'openai/gpt-oss-20b',                              // Groq recommended replacement for Llama 3.1 8B
        'openai/gpt-oss-120b',                             // bigger version
        'meta-llama/llama-4-maverick-17b-128e-instruct',    // Llama 4 Maverick
        'meta-llama/llama-4-scout-17b-16e-instruct',        // Llama 4 Scout
        'llama-3.3-70b-versatile',                         // try legacy if still works
        'mistral-saba-24b'                                 // backup
      ];

      for (const model of modelsToTry) {
        try {
          console.log(`Trying Groq model: ${model}`);
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model, 
              messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-100), { role: 'user', content: userMessage }], 
              temperature: 0.7, 
              max_tokens: 800 
            })
          });
          const text = await r.text();
          console.log(`GROQ ${model} status ${r.status} -> ${text.slice(0,400)}`);
          if (r.status === 404) {
            lastError = `Model ${model} 404 not found`;
            continue;
          }
          try {
            const d = JSON.parse(text);
            if (r.ok && d.choices?.[0]?.message?.content) {
              reply = d.choices[0].message.content;
              console.log(`GROQ SUCCESS with ${model}`);
              break;
            } else if (d.error) {
              lastError = `${model}: ${d.error.message || JSON.stringify(d.error).slice(0,300)}`;
              if (text.includes('decommissioned')) continue;
            }
          } catch {
            if (r.ok && text.length > 20) { reply = text.slice(0,1500); break; }
          }
        } catch (e) {
          lastError = e.message;
        }
      }
    }

    if (!reply) {
      if (groqKey && lastError) {
        reply = `Huy buddy! Groq key exists: true but Groq failed with: ${lastError}\n\nYou said: "${String(userMessage).slice(0,80)}"\n\nNOTE: Groq retired Llama 3.1 8B on Aug 16 2026! New models are openai/gpt-oss-20b and Llama 4. I updated chat.js - push again!`;
      } else {
        reply = `Huy buddy! I'm here! You said: "${String(userMessage).slice(0,120)}" Groq key: ${!!groqKey} Error: ${lastError}`;
      }
    }

    res.status(200).json({ reply });
  } catch (err) {
    res.status(200).json({ reply: `Error: ${err.message}` });
  }
}
