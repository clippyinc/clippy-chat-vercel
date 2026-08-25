// Clippy V2 - FINAL FIX 2026 - gemini-3.5-flash-lite
export default async function handler(req, res) {
  res.setHeader("Content-Type","application/json");
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});

  try{
    const {messages, images=[]} = req.body||{};
    const key=(process.env.GEMINI_API_KEY||"").trim();
    if(!key) return res.status(200).json({reply:"Wala GEMINI_API_KEY bud! Vercel > Env Vars > GEMINI_API_KEY (AQ... no space) > Redeploy NO CACHE"});

    // VERIFICATION LAYER mo - zero token
    const lastRaw=[...messages].reverse().find(m=>m.role==="user")?.content||"";
    const last=lastRaw.toLowerCase();
    const prevBot=[...messages].reverse().find(m=>m.role==="assistant")?.content||"";
    const isYes=/^(yes|oo|sige|go|ok|confirm|yep)$/i.test(lastRaw.trim());
    const wasAsked=prevBot.includes("Gusto mo bang")||prevBot.includes("Check ba naten");
    function needConfirm(t){
      if(t.match(/\.csv|analyze.*file/)) return "Gusto mo bang analyze naten tong csv file boss? 📊 Type yes";
      if(t.match(/notes|supabase|database/)) return "Gusto mo bang i-check naten notes boss? 🗂️ Type yes";
      if(t.match(/web|internet|search|google|presyo|balita/)) return "Check ba naten sa web boss? 🌐 Type yes";
      return null;
    }
    const ask=needConfirm(last);
    if(ask &&!isYes &&!wasAsked) return res.status(200).json({reply:ask,awaitingConfirm:true});

    const history=messages.filter(m=>m.role&&m.role!=="system").slice(-8).map(m=>({role:m.role,content:String(m.content||"").slice(0,500)}));
    const now=new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila"});
    const sys=`You are Clippy barkada for Gelo, Taglish chill short, no 1., 2.1 outline. Time:${now} Respond JSON {"reply":"..."}`;

    let out=null, err="";
    // 🔥 FINAL 2026 MODELS - 3.5-flash-lite is the new one!
    const MODELS=[
      "gemini-3.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "gemini-3.5-flash",
      "gemini-2.5-flash"
    ];

    for(const model of MODELS){
      for(const ver of ["v1beta","v1"]){
        try{
          const contents=[
            {role:"user",parts:[{text:sys}]},
            {role:"model",parts:[{text:'{"reply":"Gets"}'}]},
           ...history.map(m=>({role:m.role==="assistant"?"model":"user",parts:[{text:m.content}]}))
          ];
          if(images.length){const l=contents[contents.length-1];for(const im of images.slice(0,2)){if(im?.dataUrl){const b=im.dataUrl.split(",")[1];const mime=im.dataUrl.match(/data:(.*?);/)?.[1]||"image/jpeg";if(b)l.parts.push({inlineData:{data:b,mimeType:mime}});}}}
          const r=await fetch(`https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${key}`,{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({contents,generationConfig:{temperature:0.7,maxOutputTokens:800,responseMimeType:"application/json"}})
          });
          const d=await r.json();
          if(r.ok && d.candidates?.[0]?.content?.parts?.[0]?.text){out=d.candidates[0].content.parts[0].text;console.log(`OK ${model} ${ver}`);break;}
          err=d?.error?.message||`${model} ${r.status}: ${JSON.stringify(d).slice(0,300)}`;
          console.error(err);
          if(err.includes("not found")||err.includes("no longer available")) continue;
          if(r.status===400||r.status===403) break;
        }catch(e){err=e.message;}
      }
      if(out) break;
    }

    if(!out) return res.status(200).json({reply:`Gemini error: ${err}. Fix: 1) aistudio.google.com > New key 2) Vercel Env Vars > paste > Redeploy NO CACHE`});
    let p;try{p=JSON.parse(out);}catch{p={reply:String(out).slice(0,2000)};}
    return res.status(200).json({reply:(p.reply||"Yep bud").trim()});
  }catch(e){
    return res.status(200).json({reply:`Server error: ${e.message}`});
  }
}
