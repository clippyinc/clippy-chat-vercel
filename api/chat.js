export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  try{
    let {messages,message}=req.body;
    if(!messages||!Array.isArray(messages)){
      if(message) messages=[{role:'user',content:message}];
      else return res.status(400).json({error:'messages array required'});
    }
    const openaiKey=process.env.OPENAI_API_KEY;
    const groqKey=process.env.GROQ_API_KEY;
    const apiKey=openaiKey||groqKey;
    if(!apiKey) return res.status(200).json({reply:`Buddy, no API key! Add GROQ_API_KEY in Vercel`});
    const tavilyKey=process.env.TAVILY_API_KEY;
    const useGroq=!openaiKey&&groqKey;
    const now=new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila",weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:true});
    const lastUserMsg=[...messages].reverse().find(m=>m.role==='user');
    const userQuery=lastUserMsg?.content||'';

    // Simple search
    let liveWebData='',liveSource='none';
    if(userQuery.toLowerCase().match(/today|now|mayor|marilao|bulacan|news|price/)){
      if(tavilyKey){
        try{
          const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:tavilyKey,query:userQuery.slice(0,400),search_depth:'basic',include_answer:true,max_results:5})});
          const d=await r.json(); liveWebData=d.answer||''; liveSource='tavily';
        }catch{}
      }
    }

    const coreIdentity=`CLIPPY - Gelo's AI OS, Marilao PH, Time ${now}, Personality buddy, Say "Let's continue later" NOT tomorrow! Live:${liveSource} ${liveWebData}`;
    const finalMessages=[{role:'system',content:coreIdentity},...messages.filter(m=>m.role!=='system').slice(-20)];

    let response,data;
    if(useGroq){
      const models=['llama-3.1-8b-instant','gemma2-9b-it','llama-3.1-70b-versatile'];
      for(const m of models){
        try{
          response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${groqKey}`},body:JSON.stringify({model:m,messages:finalMessages,temperature:0.7,max_tokens:1500,tool_choice:'none'})});
          data=await response.json();
          if(response.ok&&data.choices?.[0]?.message?.content) break;
          if(response.status===404||response.status===400) continue; else break;
        }catch{continue;}
      }
    }else{
      response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${openaiKey}`},body:JSON.stringify({model:'gpt-4o-mini',messages:finalMessages,temperature:0.7,max_tokens:1500})});
      data=await response.json();
    }
    if(!response.ok) return res.status(200).json({reply:`API error ${response.status}: ${data?.error?.message||JSON.stringify(data).slice(0,200)}`});
    const reply=data.choices?.[0]?.message?.content||'No reply';

    // SUPABASE - Try ALL 8 env names from your screenshot!
    let finalUrl=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
    let finalKey=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC__SE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC__ISHABLE_KEY||process.env.SUPABAS__OLE_KEY||process.env.SUPABAS__RET_KEY;

    if(!finalUrl){
      for(const [k,v] of Object.entries(process.env)){
        if(k.toLowerCase().includes('supabase')&&k.toLowerCase().includes('url')&&v&&v.includes('supabase.co')){finalUrl=v;break;}
      }
    }
    if(!finalKey){
      for(const [k,v] of Object.entries(process.env)){
        if(k.toLowerCase().includes('supabase')&&v&&v.startsWith('eyJ')&&v.length>100){finalKey=v;break;}
      }
    }

    console.log(`Supabase: url=${!!finalUrl} key=${!!finalKey} foundUrl=${finalUrl?.slice(0,30)}`);

    if(finalUrl&&finalKey){
      try{
        const supaRes=await fetch(`${finalUrl}/rest/v1/messages`,{
          method:'POST',
          headers:{'Content-Type':'application/json','apikey':finalKey,'Authorization':`Bearer ${finalKey}`,'Prefer':'return=minimal'},
          body:JSON.stringify({content:lastUserMsg.content,role:'user'})
        });
        const txt=await supaRes.text();
        console.log(`Supabase save: ${supaRes.status} ${txt.slice(0,200)}`);
      }catch(e){console.error('Supabase error',e.message);}
    }

    return res.status(200).json({reply});
  }catch(e){return res.status(500).json({error:e.message});}
}
