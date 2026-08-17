export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { messages } = req.body || {};
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;

    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    let reply = null;
    let usedModel = null;
    
    // Groq models to try - from fastest/cheapest to most capable - all FREE
    const groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile', 
      'llama3-8b-8192',
      'llama-3.1-8b-instant',
      'gemma2-9b-it',
      'mixtral-8x7b-32768'
    ];

    if (groqKey) {
      for (const model of groqModels) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model: model, 
              messages: messages.slice(-12),
              temperature: 0.7,
              max_tokens: 1000
            })
          });
          const d = await r.json();
          if (r.ok && d.choices?.[0]?.message?.content) {
            reply = d.choices[0].message.content;
            usedModel = model;
            console.log(`Groq success with ${model}`);
            break;
          } else {
            console.log(`Groq ${model} failed:`, d.error?.message || d);
            // continue to next model
          }
        } catch (e) {
          console.log(`Groq ${model} exception:`, e.message);
        }
      }
    }

    if (!reply) {
      reply = `Hey buddy! I'm Clippy - your AI. You said: "${[...messages].reverse().find(m=>m.role==='user')?.content?.slice(0,100) || 'hi'}" - I'm working! Groq tried ${groqModels.length} models but all failed. This usually means rate limit - wait 1 minute and try again! If still fails, check GROQ_API_KEY in Vercel.`;
      usedModel = 'fallback-free';
    }

    if (supaUrl && supaKey) {
      try {
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || '';
        await fetch(`${supaUrl}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' }, body: JSON.stringify({ content: lastUser, role: 'user' }) });
        await fetch(`${supaUrl}/rest/v1/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' }, body: JSON.stringify({ content: reply, role: 'assistant' }) });
      } catch {}
    }

    return res.status(200).json({ reply, model: usedModel });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
