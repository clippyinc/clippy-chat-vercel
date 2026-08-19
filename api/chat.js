export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  try{
    const {messages}=req.body;
    const groqKey=(process.env.GROQ_API_KEY||'').trim();
    const supabaseUrl=(process.env.SUPABASE_URL||'').trim().replace(/\/$/,'');
    const supabaseKey=(process.env.SUPABASE_ANON_KEY||'').trim();
    const clean=messages.filter(m=>m.role!=='system').slice(-20);
    const lastQ=clean.filter(m=>m.role==='user').slice(-1)[0]?.content||'';
    let reply=null;
    for(const model of ['llama-3.1-8b-instant','llama-3.3-70b-versatile']){
      const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},
        body:JSON.stringify({model,messages:[{role:'system',content:'You are Clippy, buddy tone' },...clean],temperature:0.7,max_tokens:800})
      });
      const d=await r.json();
      if(r.ok&&d.choices?.[0]?.message?.content){reply=d.choices[0].message.content;break;}
    }
    if(!reply)reply='Error from Groq';
    if(supabaseUrl&&supabaseKey){
      await fetch(`${supabaseUrl}/rest/v1/memories`,{
        method:'POST',
        headers:{'apikey':supabaseKey,'Authorization':`Bearer ${supabaseKey}`,'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({content:lastQ.slice(0,500),business_id:'B1'})
      }).catch(()=>{});
    }
    return res.status(200).json({reply});
  }catch(e){return res.status(200).json({reply:`Error: ${e.message}`});}
}
