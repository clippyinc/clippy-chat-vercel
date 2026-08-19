export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKey = (process.env.GROQ_API_KEY || '').trim().replace(/['"]/g, '');
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim().replace(/['"]/g, '');

    if (!groqKey &&!openaiKey) {
      return res.status(200).json({ reply: 'No key! Add GROQ_API_KEY in Vercel' });
    }

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
    const coreIdentity = `You are Clippy - Gelo's AI OS, Marilao PH, ${now}. Say "Good progress today buddy. Let's continue later." NEVER say tomorrow.`;

    const finalMessages = [{ role: 'system', content: coreIdentity },...messages.filter(m=>m.role!=='system').slice(-20)];

    let response, data;

    // Try Groq with ALL free models
    if (groqKey) {
      const groqModels = [
        'llama-3.1-8b-instant',
        'gemma2-9b-it',
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'llama-3.3-70b-versatile',
        'mixtral-8x7b-32768'
      ];

      for (const model of groqModels) {
        try {
          console.log(`Trying Groq ${model}`);
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1200 })
          });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) {
            console.log(`SUCCESS with ${model}`);
            return res.status(200).json({ reply: data.choices[0].message.content });
          }
          console.log(`Failed ${model}: ${response.status} ${data?.error?.message?.slice(0,150)}`);
        } catch(e) {
          console.log(`Error ${model}: ${e.message}`);
        }
      }
      // If all Groq models failed
      return res.status(200).json({
        reply: `Groq key valid but all models failed! Last error: ${data?.error?.message || 'unknown'}\n\nFix: Go to console.groq.com → Verify email/phone → Create NEW key → Vercel → Update GROQ_API_KEY → Redeploy\n\nTry also adding OPENAI_API_KEY if you have one!`
      });
    }

    if (openaiKey) {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
      });
      data = await response.json();
      if (response.ok) return res.status(200).json({ reply: data.choices?.[0]?.message?.content || 'No reply' });
      return res.status(200).json({ reply: `OpenAI error: ${data?.error?.message}` });
    }

    return res.status(200).json({ reply: 'No key!' });
  } catch(e) {
    return res.status(200).json({ reply: `Server error: ${e.message}` });
  }
}
