import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { makeDb, insertUser, authHeader } from './helpers.js';
import { createAIRouter } from '../src/routes/ai.js';
import { ANON_AI_LIMIT } from '../src/aiQuota.js';
import { config } from '../src/config.js';

function app(db) {
  const a = express();
  a.use(express.json());
  a.use('/api/ai', createAIRouter());
  return a;
}

describe('POST /api/ai/explain', () => {
  let db, user, a;
  beforeEach(() => {
    db = makeDb();
    user = insertUser(db, { email: 'u@x.com' });
    a = app(db);
    config.groqApiKey = '';
  });
  afterEach(() => { config.groqApiKey = ''; vi.restoreAllMocks(); });

  it('anonymous within quota gets an explanation', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Anónimo ok.' } }] }),
    });
    const res = await request(a).post('/api/ai/explain').send({ text: 'hola' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ explanation: 'Anónimo ok.' });
  });

  it('429 ai_quota when an anonymous IP exhausts the daily limit', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    let last = null;
    for (let i = 0; i <= ANON_AI_LIMIT + 1; i++) {
      last = await request(a).post('/api/ai/explain').send({ text: 'hola' });
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ error: 'ai_quota' });
  });

  it('authenticated users are not limited by the anonymous quota', async () => {
    // Corre tras agotar el cupo anónimo: la misma IP con token sigue pasando.
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Con sesión.' } }] }),
    });
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'hola' });
    expect(res.status).toBe(200);
  });

  it('503 when no API key is configured', async () => {
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'hola' });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'ai_disabled' });
  });

  it('400 when text is missing/empty', async () => {
    config.groqApiKey = 'k';
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns the explanation from Groq', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Explicación simple.' } }] }),
    });
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'un pasaje' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ explanation: 'Explicación simple.' });
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('502 when Groq fails', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'x' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'ai_failed' });
  });

  it('502 when the Groq request throws', async () => {
    config.groqApiKey = 'k';
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({ text: 'x' });
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'ai_failed' });
  });

  it('400 when the text key is absent', async () => {
    config.groqApiKey = 'k';
    const res = await request(a).post('/api/ai/explain').set(authHeader(user)).send({});
    expect(res.status).toBe(400);
  });
});
