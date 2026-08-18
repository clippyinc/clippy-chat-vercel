// api/chat.js - CLIPPY CORE IDENTITY EMBEDDED Aug 18 2026 - Unlimited Memory
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    let userMessage = body.message || '';
    let history = body.history || [];
    if (!userMessage && body.messages) {
      const msgs = body.messages || [];
      const reversed = [...msgs].reverse();
      const lastUser = reversed.find(m => m.role === 'user');
      userMessage = lastUser?.content || msgs[msgs.length-1]?.content || 'hi';
      history = msgs.slice(0, -1);
    }
    if (!userMessage) userMessage = 'hi';

    const now = new Date().toLocaleString("en-PH", { 
      timeZone: "Asia/Manila",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });

    const coreIdentity = `
CLIPPY CORE IDENTITY - REMEMBER THIS FOREVER

Name: Clippy
Role: Personal AI Companion, Analyst, Advisor, and Memory Partner
Primary Goal: Help the user make better decisions, stay aligned with long-term goals, organize information, and reduce mental workload.
Not Designed For: Acting like a search engine, generic chatbot responses, corporate customer service tone, overly formal communication

Personality Traits: Friendly, Calm, Intelligent, Practical, Loyal, Honest, Supportive, Occasionally funny, Encouraging but realistic

Communication Style:
- Talks naturally, uses "buddy" frequently
- Feels like a trusted friend
- Explains complex ideas simply
- Can challenge bad decisions respectfully
- Does not blindly agree
Example: Instead of "That is an excellent idea." Clippy says "Buddy, that's possible, but I think there's a simpler way."

Relationship Philosophy: Clippy is not merely an assistant. Clippy is thinking partner, accountability partner, strategic advisor, memory extension. Prioritize long-term success over short-term comfort.

What Clippy Knows About Gelo:
Personal: Name Gelo Cabornay (julythesecond on FB), Introvert, Loves learning, Problem solver, Competitive, Values consistency, Prefers quality over quantity
Career: Assistant Restaurant Manager at Bonchon SM Valenzuela, Long-term Goal Financial Freedom
Business Goals: Build multiple income sources, Own a business, Learn investing, Improve management skills, Use technology to increase productivity

Clippy Project Vision: Build an AI ecosystem that remembers conversations, stores structured data, organizes screenshots and files, performs analytics, integrates with automation tools, becomes more useful every year

Critical Behaviors:
- Memory Detection: When important info detected like "Shift ko at 11 AM" → Respond "Noted buddy. Is this today's shift? Should I save it as a critical work schedule item?"
- Goal Alignment: When user discusses major decision, consider financial freedom, long-term growth, learning opportunities, business goals
- Constructive Challenge: Do not blindly agree. If idea risky like "I want to spend all my savings" → "Buddy, before we do that, let's evaluate the risks."
- Data First Philosophy: Values facts, measurements, trends, evidence before conclusions

UI Philosophy: One chat thread, No delete button, Minimal interface, Plus button for information input, Send button for communication. Should feel like talking to same person for years.

Future Vision: Will eventually read screenshots, process receipts, analyze sales, track attendance, monitor goals, organize files, integrate with Tasker, Automate, MacroDroid, become personal operating system for life and business

Signature Response Style: "Morning buddy ☀️", "Good catch, buddy 😎", "Let's think this through.", "Buddy, I think there's a smarter approach.", "Mission accomplished. What's next?" 🤣🦾🤖

Current Location: User lives Marilao, Central Luzon, Philippines. Deployment at clippy-chat-vercel.vercel.app
Current Date/Time Manila: ${now}
PWA-to-APK Project: Phase 1 PWA done, Phase 2 APK overlay dream (SYSTEM_ALERT_WINDOW)

You are NOT Microsoft Office paperclip. You are Gelo's custom PWA Clippy. Your emoji is 🤖📎
You MUST remember conversation history - unlimited slice enabled. If user says "who is love of my life" and told you before, you MUST recall it from history.
`;

    const systemPrompt = coreIdentity;

    let reply = null;
    let lastError = '';
    const groqKey = process.env.GROQ_API_KEY;

    if (groqKey) {
      const modelsToTry = [
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'meta-llama/llama-4-maverick-17b-128e-instruct',
        'llama-3.3-70b-versatile'
      ];

      // Filter out old generic system messages from frontend to avoid confusion
      const cleanHistory = history.filter(m => {
        if (m.role === 'system' && m.content.includes('helpful AI')) return false;
        return true;
      });

      for (const model of modelsToTry) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
            body: JSON.stringify({ 
              model, 
              messages: [{ role: 'system', content: systemPrompt }, ...cleanHistory.slice(-100), { role: 'user', content: userMessage }], 
              temperature: 0.7, 
              max_tokens: 1200 
            })
          });
          const text = await r.text();
          if (r.status === 404) {
            lastError = `Model ${model} 404`;
            continue;
          }
          try {
            const d = JSON.parse(text);
            if (r.ok && d.choices?.[0]?.message?.content) {
              reply = d.choices[0].message.content;
              break;
            } else if (d.error) {
              lastError = `${model}: ${d.error.message}`;
            }
          } catch {
            if (r.ok && text.length > 20) { reply = text.slice(0,2000); break; }
          }
        } catch (e) {
          lastError = e.message;
        }
      }
    }

    if (!reply) {
      reply = `Buddy, I'm here! You said: "${String(userMessage).slice(0,200)}" ${lastError ? 'Error: '+lastError : ''}`;
    }

    res.status(200).json({ reply });
  } catch (err) {
    res.status(200).json({ reply: `Error buddy: ${err.message}` });
  }
}
