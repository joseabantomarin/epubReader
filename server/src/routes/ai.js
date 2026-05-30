import { Router } from 'express';
import { authRequired } from '../middleware/authRequired.js';
import { config } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_CHARS = 2000;
const SYSTEM_PROMPT =
  'Eres un asistente que explica pasajes de libros en español, de forma clara, ' +
  'breve y sencilla. No inventes contexto que no esté en el texto.';

export function createAIRouter() {
  const r = Router();
  r.use(authRequired);

  r.post('/explain', async (req, res) => {
    if (!config.groqApiKey) return res.status(503).json({ error: 'ai_disabled' });
    const raw = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!raw) return res.status(400).json({ error: 'missing_text' });
    const text = raw.slice(0, MAX_CHARS);
    try {
      const r2 = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: config.groqModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Explica este pasaje:\n\n${text}` },
          ],
        }),
      });
      if (!r2.ok) return res.status(502).json({ error: 'ai_failed' });
      const data = await r2.json();
      const explanation = data?.choices?.[0]?.message?.content?.trim();
      if (!explanation) return res.status(502).json({ error: 'ai_failed' });
      res.json({ explanation });
    } catch {
      res.status(502).json({ error: 'ai_failed' });
    }
  });

  return r;
}
