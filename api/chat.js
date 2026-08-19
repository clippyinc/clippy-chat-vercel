export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method!== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    let { messages } = req.body;
    if (!messages ||!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!groqKey &&!openaiKey) return res.status(200).json({ reply: 'Add GROQ_API_KEY in Vercel' });

    const now = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });
    const coreIdentity = `You are Clippy - Gelo's AI OS, Marilao PH. Time ${now}. Say "Good progress today buddy. Let's continue later." NEVER say tomorrow.`;

    const finalMessages = [{ role: 'system', content: coreIdentity },...messages.filter(m=>m.role!=='system').slice(-20)];

    let response, data;
    if (groqKey &&!openaiKey) {
      // ONLY working model!
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
      });
      data = await response.json();
    } else {
      response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: finalMessages, temperature: 0.7, max_tokens: 1000 })
      });
      data = await response.json();
    }

    if (!response.ok) return res.status(200).json({ reply: `API error ${response.status}: ${data?.error?.message||'error'}` });
    const reply = data.choices?.[0]?.message?.content || 'No reply';
    return res.status(200).json({ reply });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
