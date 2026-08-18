// 2. GROQ FREE - DEBUG VERSION
    const groqKey = process.env.GROQ_API_KEY;
    console.log("GROQ KEY EXISTS?",!!groqKey, groqKey? groqKey.slice(0,10)+"..." : "NO KEY");

    if (groqKey &&!reply) {
      for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt },...history.slice(-6), { role: 'user', content: userMessage }], temperature: 0.7, max_tokens: 800 })
          });
          const d = await r.json();
          console.log("GROQ TRY", model, "status:", r.status, "body:", JSON.stringify(d).slice(0,500));
          if (r.ok && d.choices?.[0]?.message?.content) { reply = d.choices[0].message.content; break; }
          else if (!r.ok) {
            console.error("GROQ ERROR", d);
          }
        } catch (e) {
          console.error("GROQ CATCH", e.message);
        }
      }
    }
