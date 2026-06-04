import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeDb, insertUser } from './helpers.js';
import { createDevice } from '../src/kobo/devices.js';
import { ensureBookUuid } from '../src/kobo/library.js';
import { createKoboRouter } from '../src/routes/kobo.js';

let db, user, token, app, uuid, bookId;
beforeEach(() => {
  db = makeDb();
  user = insertUser(db);
  token = createDevice(db, user.id).token;
  bookId = db.prepare("INSERT INTO books (user_id, title, file_path, format) VALUES (?, 'Dune', 'p', 'epub')").run(user.id).lastInsertRowid;
  uuid = ensureBookUuid(db, db.prepare('SELECT * FROM books WHERE id = ?').get(bookId));
  app = express();
  app.use(express.json());
  app.use('/kobo/:authToken', createKoboRouter(db, '/tmp'));
});

describe('kobo reading state', () => {
  it('GET returns a one-element ReadingState array', async () => {
    const res = await request(app).get(`/kobo/${token}/v1/library/${uuid}/state`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].EntitlementId).toBe(uuid);
  });

  it('PUT stores progress and GET reflects it', async () => {
    const put = await request(app)
      .put(`/kobo/${token}/v1/library/${uuid}/state`)
      .send({ ReadingStates: [{
        CurrentBookmark: {
          ProgressPercent: 30,
          ContentSourceProgressPercent: 12,
          Location: { Value: 'span#kobo.5.2', Type: 'KoboSpan', Source: 'OEBPS/ch5.xhtml' },
        },
        StatusInfo: { Status: 'Reading' },
        Statistics: { SpentReadingMinutes: 4, RemainingTimeMinutes: 100 },
      }] });
    expect(put.status).toBe(200);
    expect(put.body.RequestResult).toBe('Success');

    const row = db.prepare('SELECT * FROM reading_progress WHERE book_id = ?').get(bookId);
    expect(row.percentage).toBeCloseTo(0.12);
    expect(row.kobo_chapter_progress).toBeCloseTo(0.30);
    expect(row.kobo_location_value).toBe('span#kobo.5.2');
    expect(row.source).toBe('kobo');

    const get = await request(app).get(`/kobo/${token}/v1/library/${uuid}/state`);
    expect(get.body[0].CurrentBookmark.ContentSourceProgressPercent).toBe(12);
  });

  it('PUT with a malformed body is a 400', async () => {
    const res = await request(app).put(`/kobo/${token}/v1/library/${uuid}/state`).send({ nope: true });
    expect(res.status).toBe(400);
  });

  it('PUT to a book the device does not own is 404', async () => {
    const res = await request(app)
      .put(`/kobo/${token}/v1/library/00000000-0000-0000-0000-000000000000/state`)
      .send({ ReadingStates: [{ CurrentBookmark: {} }] });
    expect(res.status).toBe(404);
  });
});
