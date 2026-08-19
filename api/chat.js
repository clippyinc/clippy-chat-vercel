export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { messages } = req.body;
    const key = (process.env.GROQ_API_KEY || '').trim();
    const clean = messages.filter(m=>m.role!=='system').slice(-20);
    const lastQ = clean.filter(m=>m.role==='user').slice(-1)[0]?.content||'';

    let reply = null;
    let err = '';

    // WORKING MODELS ONLY - no gemma2
    for (const model of ['llama-3.1-8b-instant','llama-3.3-70b-versatile']) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
        body: JSON.stringify({
          model,
          messages: [{role:'system',content:'You are Clippy, buddy tone'},...clean],
          max_tokens: 800
        })
      });
      const d = await r.json();
      if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
      err = d.error?.message || JSON.stringify(d).slice(0,200);
    }

    if (!reply) return res.status(200).json({reply:`Groq Error: ${err}`});

    // save to supabase
    const url = (process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');
    const skey = (process.env.SUPABASE_ANON_KEY||'').trim();
    if (url && skey) {
      await fetch(`${url}/rest/v1/memories`,{
        method:'POST',
        headers:{'apikey':skey,'Authorization':`Bearer ${skey}`,'Content-Type':'application/json','Prefer':'return=minimal'},
        body: JSON.stringify({content:lastQ.slice(0,500), business_id:'B1'})
      }).catch(()=>{});
    }

    return res.status(200).json({reply});
  } catch(e){
    return res.status(200).json({reply:`Error: ${e.message}`});
  }
}
