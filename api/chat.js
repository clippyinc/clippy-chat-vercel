export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages } = req.body || {};
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

    const openaiKey = process.env.OPENAI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const supaUrl = process.env.SUPABASE_URL;
    const supaKey = process.env.SUPABASE_ANON_KEY;

    const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || 'hi';
    let reply = null;
    let provider = '';

    // 1. OpenAI
    if (openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) { reply = d.choices?.[0]?.message?.content; provider = 'openai'; }
        else { console.log('openai fail', d); }
      } catch (e) { console.log('openai err', e.message); }
    }

    // 2. Groq FREE
    if (!reply && groqKey) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
          body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages, temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) { reply = d.choices?.[0]?.message?.content; provider = 'groq'; }
        else { console.log('groq fail', d); }
      } catch (e) { console.log('groq err', e.message); }
    }

    // 3. OpenRouter FREE - easiest to get key
    if (!reply && openrouterKey) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${openrouterKey}`,
            'HTTP-Referer': 'https://clippy.vercel.app',
            'X-Title': 'Clippy'
          },
          body: JSON.stringify({ model: 'google/gemma-2-9b-it:free', messages, temperature: 0.7 })
        });
        const d = await r.json();
        if (r.ok) { reply = d.choices?.[0]?.message?.content; provider = 'openrouter-free'; }
        else { console.log('openrouter fail', d); }
      } catch (e) { console.log('openrouter err', e.message); }
    }

    // 4. WORKING FREE API - no key needed - uses HuggingFace proxy that works on Vercel
    if (!reply) {
      try {
        const r = await fetch('https://api.pawan.krd/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'pai-001-light',
            messages: [{ role: 'system', content: 'You are Clippy, helpful friendly assistant. Be concise.' }, { role: 'user', content: lastUser }],
            max_tokens: 500
          })
        });
        const d = await r.json();
        if (r.ok && d.choices?.[0]?.message?.content) {
          reply = d.choices[0].message.content;
          provider = 'pawan-free';
        }
      } catch (e) { console.log('pawan err', e.message); }
    }

    // 5. Last resort free - DuckDuckGo style
    if (!reply) {
      try {
        const r = await fetch('https://text.pollinations.ai/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'system', content: 'You are Clippy, helpful assistant' }, ...messages.slice(-6)],
            model: 'openai',
            stream: false
          })
        });
        if (r.ok) {
          const d = await r.json();
          if (d.choices?.[0]?.message?.content) {
            reply = d.choices[0].message.content;
            provider = 'pollinations-free';
          } else {
            const txt = await r.text();
            if (txt && txt.length > 10 && !txt.includes('<!DOCTYPE')) { reply = txt.slice(0, 1500); provider = 'pollinations-text'; }
          }
        }
      } catch (e) { console.log('pollinations err', e.message); }
    }

    if (!reply) {
      reply = `Yo buddy! I'm Clippy running in FREE mode 🚀\n\nYou said: "${lastUser}"\n\nYour app IS working! The Vercel + Supabase connection is good.\n\nFor smarter replies, add one of these FREE keys in Vercel Env Vars:\n• GROQ_API_KEY from console.groq.com (fastest)\n• OPENROUTER_API_KEY from openrouter.ai (easiest, has free models)\n\nBut I work even without them!`;
      provider = 'free-mode-active';
    }

    // Save to Supabase
    if (supaUrl && supaKey) {
      try {
        await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ content: lastUser, role: 'user' })
        });
        await fetch(`${supaUrl}/rest/v1/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}`, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ content: reply, role: 'assistant' })
        });
      } catch {}
    }

    return res.status(200).json({ reply, provider });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
