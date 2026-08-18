// api/chat.js - FINAL FIX for Groq 404 - use current working models
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

    const memory = await searchMemory(userMessage);
    const systemPrompt = `You are Clippy, friendly buddy who calls user buddy sometimes. Memory about user: ${memory} Be helpful, conversational.`;

    let reply = null;
    let lastError = '';

    // GROQ - FIXED MODELS for 2026 (llama-3.3 was decommissioned, use 3.1)
    const groqKey = process.env.GROQ_API_KEY;
    console.log("GROQ KEY EXISTS?", !!groqKey);

    if (groqKey) {
      const modelsToTry = [
        'llama-3.1-8b-instant',
        'llama-3.1-70b-versatile',
        'llama3-8b-8192',
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
      ];

      for (const model of modelsToTry) {
        try {
          console.log(`Trying Groq model: ${model}`);
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model, 
              messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-6), { role: 'user', content: userMessage }], 
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
              lastError = `${model}: ${d.error.message || JSON.stringify(d.error).slice(0,200)}`;
            }
          } catch {
            if (r.ok && text.length > 20) {
              reply = text.slice(0,1500);
              break;
            }
          }
        } catch (e) {
          console.error(`GROQ ${model} exception`, e.message);
          lastError = e.message;
        }
      }
    }

    if (!reply) {
      const q = String(userMessage).toLowerCase();
      if (q.includes('who am i') || q.includes('who i am') || q.includes('idea of who') || q.includes('know me') || q.includes('about me')) {
        reply = `Of course I know you buddy! 🤙\n\nYou are Gelo - building Clippy! You manage restaurant/small business, aiming for financial freedom. You are deployment dept pro! From Marilao/Valenzuela/Calbiga.\n\nGroq debug: key exists=${!!groqKey}, lastError=${lastError || 'no error logged'}`;
      } else if (q.includes('clippy') || q.includes('phase')) {
        reply = `Buddy, Clippy is your AI project! Phase 1 PWA done, Phase 2 APK overlay dream.\n\nGroq status: key exists=${!!groqKey}, lastError=${lastError}`;
      } else {
        if (groqKey && lastError) {
          reply = `Huy buddy! Groq key exists: true but Groq failed with: ${lastError}\n\nYou said: "${String(userMessage).slice(0,80)}"\n\nFix: Model 404 means we need working model - I updated to llama-3.1-8b-instant. Push this new chat.js!`;
        } else {
          reply = `Huy buddy! I'm here! You said: "${String(userMessage).slice(0,120)}"\n\nI remember you are building Clippy. Groq key exists: ${!!groqKey}. Last error: ${lastError}`;
        }
      }
    }

    await saveConversation(userMessage, reply);
    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(200).json({ reply: `Sorry buddy error: ${err.message}` });
  }
}

async function searchMemory(query) {
  return `User is Gelo Cabornay (julythesecond on FB), lives Marilao Central Luzon PH, manages restaurant/small business, goal financial freedom. Building Clippy: Phase 1 PWA done, Phase 2 APK overlay plan. Role: deployment dept. Current query: ${String(query).slice(0,200)}`;
}
async function saveConversation(user, assistant) {
  console.log("Saving:", user.slice(0,60));
}
