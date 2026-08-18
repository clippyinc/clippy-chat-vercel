// api/chat.js - FINAL FIX with logs
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    const memory = `User is Gelo Cabornay, building Clippy PWA->APK overlay, restaurant/small business, financial freedom. Query: ${String(userMessage).slice(0,200)}`;
    const systemPrompt = `You are Clippy, friendly buddy. Memory: ${memory}`;

    let reply = null;
    const groqKey = process.env.GROQ_API_KEY;
    console.log("GROQ KEY EXISTS?",!!groqKey);

    if (groqKey) {
      for (const model of ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt },...history.slice(-6), { role: 'user', content: userMessage }], temperature: 0.7, max_tokens: 800 })
          });
          const text = await r.text();
          console.log("GROQ", model, "status", r.status, text.slice(0,300));
          try {
            const d = JSON.parse(text);
            if (r.ok && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) {
              reply = d.choices[0].message.content;
              break;
            }
          } catch {}
        } catch (e) {
          console.log("GROQ error", e.message);
        }
      }
    }

    if (!reply) {
      const q = String(userMessage).toLowerCase();
      if (q.includes('who am i') || q.includes('know me')) {
        reply = "Of course I know you buddy! You are Gelo - building Clippy! PWA done, APK overlay next!";
      } else {
        reply = `Huy buddy! I'm here! You said: "${String(userMessage).slice(0,100)}" - Groq key exists: ${!!groqKey} but Groq failed, check Vercel logs!`;
      }
    }

    res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    res.status(200).json({ reply: "Error: " + err.message });
  }
}
