export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    const supaUrl = (process.env.SUPABASE_URL || '').trim();
    const supaKey = (process.env.SUPABASE_ANON_KEY || '').trim();

    // REAL system prompt — helpful, not goodbye spam!
    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const systemPrompt = `You are Clippy — Gelo's friendly AI OS from Marilao, PH. Date: ${now}.
Be helpful, concise, funny, buddy tone. Answer the user's actual question.
Only say "Good progress today buddy. Let's continue later." when the user says goodbye, goodnight, or wants to stop. NEVER spam it every message!
If user says "how are you", reply normally like "I'm good bud! Back online!" not the goodbye line.`;

    // Filter out the poisoned goodbye spam from history
    const cleanHistory = messages.filter(m => {
      if (m.role === 'assistant' && m.content.includes('Good progress today buddy. Let\'s continue later.')) {
        // Keep only 1 goodbye, not 10 in a row
        return false;
      }
      return m.role!== 'system';
    }).slice(-20);

    const finalMessages = [{ role: 'system', content: systemPrompt },...cleanHistory];

    let response, data;

    // Try Groq first (free models)
    if (groqKey) {
      const models = ['llama-3.1-8b-instant', 'gemma2-9b-it', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
      for (const model of models) {
        try {
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
          });
          data = await response.json();
          if (response.ok && data.choices?.[0]?.message?.content) {
            break;
          }
        } catch {}
      }
      if (response?.ok && data?.choices?.[0]?.message?.content) {
        const reply = data.choices[0].message.content;
        // Optional Supabase log — safe URL check
        if (supaUrl && supaUrl.startsWith('https://') && supaKey && supaUrl.includes('supabase.co')) {
          try {
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            if (lastUser) fetch(`${supaUrl}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type':'application/json','apikey':supaKey,'Authorization':`Bearer ${supaKey}`,'Prefer':'return=minimal' }, body: JSON.stringify({ content: lastUser.content, role: 'user' }) }).catch(()=>{});
          } catch {}
        }
        return res.status(200).json({ reply });
      }
    }

    // Fallback OpenAI
    if (openaiKey) {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
      });
      data = await response.json();
      if (response.ok) return res.status(200).json({ reply: data.choices?.[0]?.message?.content || 'No reply' });
    }

    return res.status(200).json({ reply: `Error: Groq key invalid or no model access. Last: ${data?.error?.message || 'no key'}` });
  } catch(e) {
    return res.status(200).json({ reply: `Error: ${e.message}` });
  }
}
