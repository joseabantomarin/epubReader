import { describe, it, expect } from 'vitest';
import {
  downloadUrls, createBookEntitlement, getMetadata,
  getReadingStateResponse, koboResources,
} from '../src/kobo/serializers.js';

const BASE = 'https://lib.example';
const TOKEN = 'abc123';
const book = {
  id: 7, title: 'Dune', author: 'Frank Herbert',
  file_size: 1234, uploaded_at: '2026-06-03 12:00:00',
};
const UUID = '11111111-1111-1111-1111-111111111111';

describe('kobo/serializers', () => {
  it('downloadUrls points at our download route with KEPUB format', () => {
    const [d] = downloadUrls(BASE, TOKEN, book);
    expect(d.Format).toBe('KEPUB');
    expect(d.Size).toBe(1234);
    expect(d.Platform).toBe('Generic');
    expect(d.Url).toBe('https://lib.example/kobo/abc123/download/7/kepub');
  });

  it('entitlement uses the uuid for all id fields and is Active', () => {
    const e = createBookEntitlement(book, UUID);
    expect(e.Id).toBe(UUID);
    expect(e.CrossRevisionId).toBe(UUID);
    expect(e.RevisionId).toBe(UUID);
    expect(e.Status).toBe('Active');
    expect(e.IsRemoved).toBe(false);
    expect(e.Created).toBe('2026-06-03T12:00:00.000Z');
  });

  it('metadata carries title, contributors, and download urls', () => {
    const m = getMetadata(BASE, TOKEN, book, UUID);
    expect(m.Title).toBe('Dune');
    expect(m.WorkId).toBe(UUID);
    expect(m.CoverImageId).toBe(UUID);
    expect(m.Contributors).toEqual(['Frank Herbert']);
    expect(m.DownloadUrls[0].Url).toContain('/download/7/kepub');
  });

  it('reading-state maps stored progress into CurrentBookmark', () => {
    const rs = getReadingStateResponse(UUID, {
      percentage: 0.5, kobo_chapter_progress: 0.25,
      kobo_chapter_id: 'ch3', kobo_location_value: 'span#kobo.3.1',
      last_read_at: '2026-06-03 12:00:00',
    });
    expect(rs.EntitlementId).toBe(UUID);
    expect(rs.CurrentBookmark.ProgressPercent).toBe(25);
    expect(rs.CurrentBookmark.ContentSourceProgressPercent).toBe(50);
    expect(rs.CurrentBookmark.Location).toEqual({ Value: 'span#kobo.3.1', Type: 'KoboSpan', Source: 'ch3' });
    expect(rs.StatusInfo.Status).toBe('Reading');
  });

  it('resources override image + sync URLs to point at us', () => {
    const r = koboResources(BASE, TOKEN);
    expect(r.image_url_template).toBe('https://lib.example/kobo/abc123/{ImageId}/{width}/{height}/false/image.jpg');
    expect(r.library_sync).toBe('https://lib.example/kobo/abc123/v1/library/sync');
    expect(r.image_host).toBe('https://lib.example');
  });
});
