import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { config } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_CHARS = 2000;
const SYSTEM_PROMPT =
  'Eres un asistente que responde en español de forma clara, breve y sencilla. ' +
  'Responde solo lo que se te pide y no inventes información ni contexto que no se te haya dado.';

export function createAIRouter() {
  const r = Router();
  r.use(authRequired);

  r.post('/explain', async (req, res) => {
    if (!config.groqApiKey) return res.status(503).json({ error: 'ai_disabled' });
    // Accept either a single { text } (one-shot) or a { messages } conversation
    // (the reader's mini-chat). The client builds the full prompt; we just relay.
    let convo = null;
    if (Array.isArray(req.body?.messages)) {
      convo = req.body.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant')
          && typeof m.content === 'string' && m.content.trim())
        .slice(-12) // keep the conversation bounded
        .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
    } else {
      const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (raw) convo = [{ role: 'user', content: raw.slice(0, MAX_CHARS) }];
    }
    if (!convo || !convo.length) return res.status(400).json({ error: 'missing_text' });
    try {
      const groqRes = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: config.groqModel,
          temperature: 0.3,
          max_tokens: 600,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...convo,
          ],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!groqRes.ok) return res.status(502).json({ error: 'ai_failed' });
      const data = await groqRes.json();
      const explanation = data?.choices?.[0]?.message?.content?.trim();
      if (!explanation) return res.status(502).json({ error: 'ai_failed' });
      res.json({ explanation });
    } catch {
      res.status(502).json({ error: 'ai_failed' });
    }
  });

  return r;
}
