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
    const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!raw) return res.status(400).json({ error: 'missing_text' });
    const text = raw.slice(0, MAX_CHARS);
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
          max_tokens: 400,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            // The client already built the full instruction (define vs. explain),
            // so forward it verbatim instead of re-wrapping it as a "pasaje".
            { role: 'user', content: text },
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
