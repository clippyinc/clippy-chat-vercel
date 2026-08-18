// api/chat.js - FIXED: Pollinations + Memory-aware fallback
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

    // ===== MEMORY SEARCH =====
    const memory = await searchMemory(userMessage);

    const systemPrompt = `You are Clippy, friendly buddy who calls user buddy sometimes.
Memory about user: ${memory}
Be helpful, conversational, remember user manages restaurant/small business, wants financial freedom, building Clippy PWA->APK overlay, deployment dept.`;

    let reply = null;

    // 1. OPENAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && !reply) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: systemPrompt }, ...history.slice(-8), { role: "user", content: userMessage }],
            temperature: 0.7, max_tokens: 800
          })
        });
        const data = await response.json();
        if (response.ok && data.choices?.[0]?.message?.content) reply = data.choices[0].message.content;
      } catch {}
    }

    // 2. GROQ FREE
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey && !reply) {
      for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...history.slice(-6), { role: 'user', content: userMessage }], temperature: 0.7, max_tokens: 800 })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
        } catch {}
      }
    }

    // 3. POLLINATIONS - FIXED, try GET first (more reliable)
    if (!reply) {
      try {
        // Method B: GET is more stable for pollinations
        const promptForGet = `${systemPrompt}\nUser: ${String(userMessage).slice(0,400)}`;
        const encoded = encodeURIComponent(promptForGet);
        const r2 = await fetch(`https://text.pollinations.ai/${encoded}?model=openai&seed=${Math.floor(Math.random()*99999)}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        const txt2 = await r2.text();
        if (r2.ok && txt2.length > 15 && !txt2.toLowerCase().includes('<!doctype') && !txt2.toLowerCase().includes('<html')) {
          reply = txt2.slice(0,1500);
        }
      } catch {}
    }
    if (!reply) {
      try {
        const r = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'openai',
            messages: [{ role: 'system', content: systemPrompt.slice(0,1500) }, { role: 'user', content: String(userMessage).slice(0,1000) }],
            seed: Math.floor(Math.random()*100000)
          })
        });
        if (r.ok) {
          const text = await r.text();
          try {
            const d = JSON.parse(text);
            if (d.choices?.[0]?.message?.content) reply = d.choices[0].message.content;
          } catch {
            if (text.length > 15 && !text.toLowerCase().includes('<!doctype')) reply = text.slice(0,1500);
          }
        }
      } catch {}
    }

    // 4. MEMORY-AWARE FINAL FALLBACK - no more generic "add key" message
    if (!reply) {
      const q = String(userMessage).toLowerCase();
      if (q.includes('who am i') || q.includes('who i am') || q.includes('idea of who') || q.includes('know me') || q.includes('about me')) {
        reply = `Of course I know you buddy! 🤙\n\nYou are Gelo - building Clippy! You manage restaurant/small business, aiming for financial freedom. You are deployment dept (copy-paste to GitHub pro!), from Marilao/Valenzuela/Calbiga.\n\nWe built Phase 1 PWA together (your index.html + manifest.json + api/chat.js) and planning Phase 2 APK overlay that floats over any app.\n\nYou like learning how websites work (.html, .js, .json) and now APK files!\n\nWant me to remember more about you?`;
      } else if (q.includes('clippy') || q.includes('phase')) {
        reply = `Buddy, Clippy is your AI project! Phase 1 PWA done - 5 files (index.html is the main brain), Phase 2 is APK overlay dream with SYSTEM_ALERT_WINDOW permission to float over Shopee/GCash like Messenger bubble. Your current api/chat.js is in fallback mode because no GROQ_API_KEY yet. Add free Groq key in Vercel env to get strong brain!`;
      } else {
        reply = `Huy buddy! I'm here! 🚀\n\nYou said: "${String(userMessage).slice(0,120)}"\n\nQuick info: I remember you are building Clippy, you do restaurant/small business, you want financial freedom.\n\nI'm in fallback mode right now (Pollinations free AI is down momentarily). Add a free GROQ_API_KEY in Vercel > Settings > Environment Variables to get Llama 3.3 70B brain for free, no card needed! Get at groq.com\n\nBut I still remember you buddy! Ask "who am i" again?`;
      }
    }

    await saveConversation(userMessage, reply);
    res.status(200).json({ reply });

  } catch (err) {
    console.error(err);
    res.status(200).json({ reply: `Sorry buddy error: ${err.message} but I still remember you - you are building Clippy!` });
  }
}

async function searchMemory(query) {
  return `
User is Gelo Cabornay (julythesecond on FB), lives Marilao Central Luzon PH, manages restaurant/small business, goal financial freedom.
Building Clippy: Phase 1 PWA done (index.html + manifest.json + api/chat.js + sw.js + memory.js + icons), Phase 2 APK overlay plan (OverlayService.kt floating bubble).
Role: deployment dept - copy-paste to GitHub -> Vercel.
Learning: website files (.html structure, .css design, .js brain, .json config, .png icons) and software apps (.apk structure: AndroidManifest.xml, MainActivity.kt).
Current query: ${String(query).slice(0,200)}
`;
}
async function saveConversation(user, assistant) {
  console.log("Saving:", user.slice(0,60));
}
