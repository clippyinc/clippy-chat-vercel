export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  try{
    const {messages,businessId="B1",mode="casual",use_db=false}=req.body||{};
    if(!Array.isArray(messages)) return res.status(400).json({error:"messages must be array"});
    const groqKey=(process.env.GROQ_API_KEY||"").trim();
    const openaiKey=(process.env.OPENAI_API_KEY||"").trim();
    const tavilyKey=(process.env.TAVILY_API_KEY||"").trim();
    const supabaseUrl=(process.env.SUPABASE_URL||"").trim();
    const supabaseKey=(process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
    if(!groqKey&&!openaiKey) return res.status(200).json({reply:"Buddy, wala pa akong AI API key. Add GROQ_API_KEY sa Vercel."});

    // FIXED TOKEN KILLER
    const cleanHistory=messages.filter(m=>m&&m.role&&m.role!=="system").slice(-8).map(m=>({role:m.role,content:String(m.content||"").slice(0,500)}));
    const lastUserMessage=[...cleanHistory].reverse().find(m=>m.role==="user");
    const lastUserQ=lastUserMessage?.content?.trim()||"";
    if(!lastUserQ) return res.status(400).json({error:"No user message"});

    const now=new Date();
    const localDateTime=now.toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"full",timeStyle:"long"});

    function supabaseHeaders(json=false){const h={apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`};if(json){h["Content-Type"]="application/json";h["Prefer"]="return=representation";}return h;}
    async function supabaseRequest(method,table,query="",body=null){if(!supabaseUrl||!supabaseKey)return {ok:false,data:null,error:"no supabase"};try{const r=await fetch(`${supabaseUrl}/rest/v1/${table}${query}`,{method,headers:supabaseHeaders(method!=="GET"),body:body?JSON.stringify(body):undefined});const text=await r.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}return {ok:r.ok,status:r.status,data,error:r.ok?null:text};}catch(e){return {ok:false,data:null,error:e.message};}}
    const supabaseGet=(t,q)=>supabaseRequest("GET",t,q);
    const supabaseInsert=(t,p)=>supabaseRequest("POST",t,"",p);

    let contextData={tasks:"",schedules:"",memories:"",businessData:"",reminders:""};
    if(use_db&&supabaseUrl&&supabaseKey){
      try{
        const reminderMatch=lastUserQ.match(/remind me to (.+) (tomorrow|today|at \d+|on.+)/i);
        if(reminderMatch){try{const title=reminderMatch[1].trim();await supabaseInsert("schedules",{business_id:businessId,title:title.slice(0,500),scheduled_at:new Date(Date.now()+86400000).toISOString(),status:"pending"});contextData.reminders=`\n\nNEW REMINDER SET: ${title}`;}catch{}}
        const [taskRes,scheduleRes,memoryRes,businessRes]=await Promise.all([
          supabaseGet("tasks",`?business_id=eq.${encodeURIComponent(businessId)}&is_done=eq.false&select=title,due_at&order=created_at.desc&limit=20`),
          supabaseGet("schedules",`?business_id=eq.${encodeURIComponent(businessId)}&select=title,scheduled_at,status&order=scheduled_at.asc&limit=20`),
          supabaseGet("memories",`?business_id=eq.${encodeURIComponent(businessId)}&select=content,role,created_at&order=created_at.desc&limit=100`),
          supabaseGet("business_data","?select=id,name&limit=30")
        ]);
        if(taskRes.ok&&taskRes.data?.length)contextData.tasks="\n\nTASKS:\n"+taskRes.data.map(t=>`- ${t.title} | ${t.due_at||'N/A'}`).join("\n");
        if(scheduleRes.ok&&scheduleRes.data?.length)contextData.schedules="\n\nSCHEDULES:\n"+scheduleRes.data.map(s=>`- ${s.title} | ${s.scheduled_at}`).join("\n");
        if(memoryRes.ok&&memoryRes.data?.length){const qWords=lastUserQ.toLowerCase().split(/\s+/).filter(w=>w.length>=3);const scored=memoryRes.data.map(m=>{let score=0;const c=String(m.content||'').toLowerCase();qWords.forEach(w=>{if(c.includes(w))score+=2;});return {...m,_score:score};}).sort((a,b)=>b._score-a._score).slice(0,5);contextData.memories="\n\nMEMORIES:\n"+scored.map(m=>`[${m.role}] ${m.content}`).join("\n");}
        if(businessRes.ok&&businessRes.data?.length)contextData.businessData="\n\nBUSINESS:\n"+businessRes.data.map(b=>`- ${b.id}: ${b.name}`).join("\n");
      }catch(e){console.error(e);}
    }

    let webContext="";let webImages=[];
    const needsWeb=/weather|news|latest|current|today|price|search|who is|what is|nba|score|stock|usd|php|image|video|show/i.test(lastUserQ);
    if(needsWeb&&tavilyKey){
      try{
        const r=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:tavilyKey,query:lastUserQ,max_results:5,search_depth:"basic",include_answer:true,include_images:true})});
        const data=await r.json();if(r.ok&&data.results){webContext="\n\nWEB:\n"+data.results.map(x=>`- ${x.title}: ${String(x.content||'').slice(0,400)}`).join("\n");if(data.images)webImages=data.images.slice(0,3);}
      }catch(e){console.error(e);}
    }

    const personalities={
      casual:`You are Clippy, barkada mode. Taglish chill, short. Call bud/buddy ONLY 30% occasionally. No DB work now. If images, show as ![desc](url)`,
      work:`You are Clippy, work mode. Professional friendly. Call boss/bossing ONLY 30% when important. You HAVE DB. Jobs: pull/push DB, file gen, file reader. When web search, ALWAYS show images as ![desc](url)`
    };
    const systemPrompt=`${personalities[mode]||personalities.casual}\nTIME: ${localDateTime}\nBusiness: ${businessId} Mode:${mode} use_db:${use_db}\n${use_db?`DB:\n${contextData.reminders}\n${contextData.tasks}\n${contextData.schedules}\n${contextData.memories}\n${contextData.businessData}\n`:"No DB - casual"}\nWEB:\n${webContext||"No web"}\n${webImages.length?"\nIMAGES:\n"+webImages.map(url=>`![image](${url})`).join("\n"):""}\n\nRULES: Respond ONLY valid JSON: {"reply":"text with ![desc](url) if any","actions":[]} Actions: memory/task/schedule/business_data. Only when worth storing. Don't say saved. Talk WITH Gelo. Include 1-2 markdown images if available.`;
    const finalMessages=[{role:"system",content:systemPrompt},...cleanHistory];

    let aiResult=null,lastErr="";
    if(groqKey){
      // FIXED: ONLY 2 WORKING MODELS, NO DEAD ONES
      const models=["llama-3.3-70b-versatile","openai/gpt-oss-20b"];
      for(const model of models){
        try{
          console.log("Trying Groq:",model);
          const r=await fetch("https://api.groq.com/openai/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${groqKey}`},body:JSON.stringify({model,messages:finalMessages,temperature:0.7,max_tokens:1000,response_format:{type:"json_object"}})});
          const d=await r.json();
          if(r.ok&&d.choices?.[0]?.message?.content){aiResult=d.choices[0].message.content;console.log("Success:",model);break;}
          lastErr=d?.error?.message||`Groq ${r.status}: ${JSON.stringify(d).slice(0,300)}`;
          console.error("Groq fail:",model,lastErr);
        }catch(e){lastErr=e.message;console.error("Groq exception:",e);}
      }
    }
    if(!aiResult&&openaiKey){
      try{
        const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${openaiKey}`},body:JSON.stringify({model:"gpt-4o-mini",messages:finalMessages,temperature:0.7,max_tokens:1000,response_format:{type:"json_object"}})});
        const d=await r.json();if(r.ok&&d.choices?.[0]?.message?.content)aiResult=d.choices[0].message.content;else lastErr=d?.error?.message||`OpenAI ${r.status}`;
      }catch(e){lastErr=e.message;}
    }
    if(!aiResult)return res.status(200).json({reply:`Buddy, nag-fail AI: ${lastErr}. Check Vercel logs.`,images:webImages,error:lastErr});

    let parsed;
    try{parsed=JSON.parse(aiResult);}catch(e){
      // FIX STRING ERROR: if not JSON, wrap as reply
      console.error("JSON parse fail, wrapping:",aiResult.slice(0,200));
      parsed={reply:String(aiResult).slice(0,2000),actions:[]};
    }
    let reply=(parsed.reply||"Yep bud.").trim();
    let actions=Array.isArray(parsed.actions)?parsed.actions:[];

    if(use_db&&supabaseUrl&&supabaseKey&&actions.length){
      for(const a of actions){
        if(!a?.type||!a?.data)continue;
        try{
          if(a.type==="memory"&&a.data.content)await supabaseInsert("memories",{business_id:businessId,content:String(a.data.content).slice(0,1000),role:"user"});
          if(a.type==="task"&&a.data.title)await supabaseInsert("tasks",{business_id:businessId,title:String(a.data.title).slice(0,500),due_at:a.data.due_at||null,is_done:false});
          if(a.type==="schedule"&&a.data.title)await supabaseInsert("schedules",{business_id:businessId,title:String(a.data.title).slice(0,500),scheduled_at:a.data.scheduled_at||new Date().toISOString(),status:a.data.status||"pending"});
          if(a.type==="business_data"&&a.data.name)await supabaseInsert("business_data",{business_id:businessId,name:String(a.data.name).slice(0,1000)});
        }catch{}
      }
    }
    if(use_db&&supabaseUrl&&supabaseKey){try{await supabaseInsert("messages",[{business_id:businessId,content:lastUserQ.slice(0,1000),role:"user"},{business_id:businessId,content:reply.slice(0,1000),role:"assistant"}]);}catch{}}
    reply=reply.replace(/```[\s\S]*?```/g,"").trim();
    return res.status(200).json({reply,mode,use_db,images:webImages});
  }catch(e){console.error("FATAL",e);return res.status(500).json({reply:"Buddy, server error. Check Vercel logs.",error:e.message});}
}
