const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function tryGroq(messages, env) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function tryGeminiWithKey(messages, apiKey) {
  const systemMsg = messages.find(m => m.role === 'system');
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } }),
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

async function tryGemini(messages, env) {
  const keys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY_2].filter(Boolean);
  let lastError;
  for (const key of keys) {
    try {
      return await tryGeminiWithKey(messages, key);
    } catch (e) {
      lastError = e;
      console.error('Gemini key failed:', e.message);
    }
  }
  throw lastError;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    // 認証
    const auth = request.headers.get('Authorization');
    if (!env.APP_SECRET || auth !== `Bearer ${env.APP_SECRET}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const { messages } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'messages required' }, 400);
    }

    // Groq → Gemini の順で試す
    try {
      const text = await tryGroq(messages, env);
      return json({ text, provider: 'groq' });
    } catch (e) {
      console.error('Groq failed:', e.message);
    }

    try {
      const text = await tryGemini(messages, env);
      return json({ text, provider: 'gemini' });
    } catch (e) {
      console.error('Gemini failed:', e.message);
      return json({ error: 'All AI providers failed' }, 503);
    }
  },
};
