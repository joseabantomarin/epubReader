import { toKoboTimestamp } from './format.js';

const STORE = 'https://storeapi.kobo.com';

/** @param {string} baseUrl @param {string} token @param {{ id:number, file_size?:number }} book */
export function downloadUrls(baseUrl, token, book) {
  return [{
    Format: 'KEPUB',
    Size: book.file_size || 0,
    Url: `${baseUrl}/kobo/${token}/download/${book.id}/kepub`,
    Platform: 'Generic',
  }];
}

/** @param {{ uploaded_at?:string }} book @param {string} uuid */
export function createBookEntitlement(book, uuid) {
  const created = toKoboTimestamp(book.uploaded_at);
  return {
    Accessibility: 'Full',
    ActivePeriod: { From: toKoboTimestamp(new Date()) },
    Created: created,
    CrossRevisionId: uuid,
    Id: uuid,
    IsRemoved: false,
    IsHiddenFromArchive: false,
    IsLocked: false,
    LastModified: created,
    OriginCategory: 'Imported',
    RevisionId: uuid,
    Status: 'Active',
  };
}

/** @param {string} baseUrl @param {string} token @param {{ id:number, title:string, author?:string|null, uploaded_at?:string, file_size?:number }} book @param {string} uuid */
export function getMetadata(baseUrl, token, book, uuid) {
  const contributors = book.author ? [book.author] : [];
  return {
    Categories: ['00000000-0000-0000-0000-000000000001'],
    CoverImageId: uuid,
    CrossRevisionId: uuid,
    CurrentDisplayPrice: { CurrencyCode: 'USD', TotalAmount: 0 },
    CurrentLoveDisplayPrice: { TotalAmount: 0 },
    Description: '',
    DownloadUrls: downloadUrls(baseUrl, token, book),
    EntitlementId: uuid,
    ExternalIds: [],
    Genre: '00000000-0000-0000-0000-000000000001',
    IsEligibleForKoboLove: false,
    IsInternetArchive: false,
    IsPreOrder: false,
    IsSocialEnabled: true,
    Language: 'en',
    PhoneticPronunciations: {},
    PublicationDate: toKoboTimestamp(book.uploaded_at),
    Publisher: { Imprint: '', Name: '' },
    RevisionId: uuid,
    Title: book.title,
    WorkId: uuid,
    Contributors: contributors,
    ContributorRoles: contributors.map((name) => ({ Name: name })),
  };
}

/** @param {{ percentage?:number }} [progress] */
function statusFromProgress(progress) {
  if (!progress || !progress.percentage) return 'ReadyToRead';
  if (progress.percentage >= 0.99) return 'Finished';
  return 'Reading';
}

/**
 * @param {string} uuid
 * @param {{ percentage?:number, kobo_chapter_progress?:number, kobo_chapter_id?:string|null, kobo_location_value?:string|null, last_read_at?:string }} [progress]
 */
export function getReadingStateResponse(uuid, progress) {
  const now = toKoboTimestamp(progress && progress.last_read_at ? progress.last_read_at : new Date());
  const bookmark = { LastModified: now };
  if (progress) {
    if (progress.kobo_chapter_progress != null) {
      bookmark.ProgressPercent = Math.round(progress.kobo_chapter_progress * 100);
    }
    if (progress.percentage != null) {
      bookmark.ContentSourceProgressPercent = Math.round(progress.percentage * 100);
    }
    if (progress.kobo_location_value) {
      bookmark.Location = {
        Value: progress.kobo_location_value,
        Type: 'KoboSpan',
        Source: progress.kobo_chapter_id || '',
      };
    }
  }
  return {
    EntitlementId: uuid,
    Created: now,
    LastModified: now,
    PriorityTimestamp: now,
    StatusInfo: { LastModified: now, Status: statusFromProgress(progress), TimesStartedReading: 0 },
    Statistics: { LastModified: now },
    CurrentBookmark: bookmark,
  };
}

/**
 * Resources for /v1/initialization. Our image + sync URLs point at us; the rest
 * point at the real Kobo store so the firmware does not choke on missing keys.
 * @param {string} baseUrl @param {string} token
 */
export function koboResources(baseUrl, token) {
  const k = `${baseUrl}/kobo/${token}`;
  return {
    account_page: 'https://www.kobo.com/account/settings',
    assets: `${STORE}/v1/assets`,
    book: `${STORE}/v1/products/books/{ProductId}`,
    configuration_data: `${STORE}/v1/configuration`,
    dictionary_host: 'https://kbdownload1-a.akamaihd.net',
    discovery_host: STORE,
    image_host: baseUrl,
    image_url_quality_template: `${k}/{ImageId}/{width}/{height}/{Quality}/false/image.jpg`,
    image_url_template: `${k}/{ImageId}/{width}/{height}/false/image.jpg`,
    library_sync: `${k}/v1/library/sync`,
    oauth_host: STORE,
    products: `${STORE}/v1/products`,
    reading_state: `${STORE}/v1/library/{Ids}/state`,
    store_host: 'www.kobo.com',
    tags: `${k}/v1/library/tags`,
    user_profile: `${STORE}/v1/user/profile`,
    user_wishlist: `${STORE}/v1/user/wishlist`,
  };
}
