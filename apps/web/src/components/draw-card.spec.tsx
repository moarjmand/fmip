import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-1506: a share card is drawn to the end before it is answered, and the
 * card routes ask the API for English names whatever the reader's language.
 */

const api = vi.hoisted(() => ({
  fetchMatchCentre: vi.fn(),
  fetchForecastSummaries: vi.fn(),
  fetchCompetition: vi.fn(),
  fetchTeam: vi.fn(),
  fetchProfile: vi.fn(),
  fetchRating: vi.fn(),
  fetchPredictionHistory: vi.fn(),
  fetchPredictionShare: vi.fn(),
  fetchOwnPredictionShare: vi.fn(),
}));
vi.mock('@/lib/api', () => api);
const session = vi.hoisted(() => ({ sessionCookieHeader: vi.fn() }));
vi.mock('@/lib/session', () => session);

const { drawCard } = await import('./draw-card');
const { PlainCard } = await import('./share-card-image');

const UNREACHABLE = { ok: false, status: 503 };
const ID = '10d84d25-d490-4980-a0dc-4f2c7dd28b1a';

async function png(response: Response): Promise<Buffer> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  const body = Buffer.from(await response.arrayBuffer());
  expect(body.subarray(1, 4).toString()).toBe('PNG');
  return body;
}

const CARD = {
  fixture_id: ID,
  competition: 'Premier League',
  round: 'Regular Season - 9',
  home: { name: 'Liverpool', short_name: null },
  away: { name: 'Arsenal', short_name: null },
  actual: { home: 0, away: 1 },
  pick: { outcome: 'away', score: null },
  exact: false,
  picked_at: '2026-10-30T17:34:00.000Z',
  kickoff_at: '2026-11-01T16:30:00.000Z',
  username: 'mosiop',
};
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('drawCard', () => {
  it('answers the card it was given as a PNG', async () => {
    await png(await drawCard(createElement(PlainCard)));
  }, 20_000);

  it('answers the plain card when the renderer fails, never a broken response', async () => {
    function Unreadable(): never {
      throw new Error('lookupType: 5 - substFormat: 3 is not yet supported');
    }
    const fallback = await png(await drawCard(createElement(Unreadable)));
    const plain = await png(await drawCard(createElement(PlainCard)));
    expect(fallback.equals(plain)).toBe(true);
  }, 20_000);

  it('draws in the bundled faces, at the size asked, with the cache header asked', async () => {
    const { cardFonts } = await import('@/lib/card-fonts');
    expect((await cardFonts()).map((font) => `${font.name} ${font.weight}`)).toEqual([
      'Archivo 400',
      'Archivo 700',
      'Archivo 800',
      'Archivo Narrow 700',
      'Archivo Black 900',
      'Geist Mono 400',
    ]);
    const response = await drawCard(createElement(PlainCard), {
      size: { width: 1080, height: 1920 },
      cacheControl: 'public, max-age=60',
    });
    const body = await png(response);
    expect(body.readUInt32BE(16)).toBe(1080);
    expect(body.readUInt32BE(20)).toBe(1920);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    // A card is never listed by image search (T-1825).
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  }, 20_000);
});

describe('the called-it card routes (T-1723): nothing public without a live token', () => {
  const params = (token: string) => ({ params: Promise.resolve({ locale: 'en', token }) });

  beforeEach(() => {
    for (const fetcher of Object.values(api)) fetcher.mockReset().mockResolvedValue(UNREACHABLE);
    session.sessionCookieHeader.mockReset().mockResolvedValue(undefined);
  });

  it('draws a live link, card and story, cached for a minute at most', async () => {
    api.fetchPredictionShare.mockResolvedValue({ ok: true, status: 200, data: { card: CARD } });
    const { GET: card } = await import('@/app/[locale]/called-it/[token]/card/route');
    const { GET: story } = await import('@/app/[locale]/called-it/[token]/story/route');
    const drawn = await card(new Request('http://web.test'), params(TOKEN));
    expect((await png(drawn)).readUInt32BE(16)).toBe(1200);
    expect(drawn.headers.get('cache-control')).toBe('public, max-age=60');
    expect(
      (await png(await story(new Request('http://web.test'), params(TOKEN)))).readUInt32BE(20),
    ).toBe(1920);
    expect(api.fetchPredictionShare).toHaveBeenCalledWith(TOKEN);
  }, 30_000);

  it('answers 404 -- no picture -- for an unknown or a revoked token', async () => {
    api.fetchPredictionShare.mockResolvedValue({ ok: false, status: 404, error: null });
    const { GET } = await import('@/app/[locale]/called-it/[token]/card/route');
    const response = await GET(new Request('http://web.test'), params('revoked-or-unknown'));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBeNull();
    // The API being down is not a 404, and still no picture.
    api.fetchPredictionShare.mockResolvedValue({ ok: false, status: 0, error: null });
    expect((await GET(new Request('http://web.test'), params(TOKEN))).status).toBe(503);
  });

  it('draws the owner preview only for the owner, never cached anywhere shared', async () => {
    const { GET } = await import('@/app/[locale]/predictions/[id]/share/preview/route');
    const own = { params: Promise.resolve({ locale: 'en', id: ID }) };
    // Somebody else's prediction: the API answers 404, so does the route.
    session.sessionCookieHeader.mockResolvedValue('fmip_session=other');
    api.fetchOwnPredictionShare.mockResolvedValue({ ok: false, status: 404, error: null });
    expect((await GET(new Request('http://web.test'), own)).status).toBe(404);
    // A pick that is not correct has no card either.
    api.fetchOwnPredictionShare.mockResolvedValue({
      ok: true,
      status: 200,
      data: { kind: 'not_called', reason: 'wrong' },
    });
    expect((await GET(new Request('http://web.test'), own)).status).toBe(404);
    session.sessionCookieHeader.mockResolvedValue('fmip_session=owner');
    api.fetchOwnPredictionShare.mockResolvedValue({
      ok: true,
      status: 200,
      data: { kind: 'called', card: CARD, share: null },
    });
    const drawn = await GET(new Request('http://web.test'), own);
    await png(drawn);
    expect(drawn.headers.get('cache-control')).toBe('private, no-store');
    expect(api.fetchOwnPredictionShare).toHaveBeenLastCalledWith(ID, 'fmip_session=owner');
  }, 30_000);
});

describe('the brand card route (T-1825)', () => {
  beforeEach(() => {
    for (const fetcher of Object.values(api)) fetcher.mockReset().mockResolvedValue(UNREACHABLE);
  });

  it('draws B10 from nothing but itself, once, kept a day and never indexed', async () => {
    const { GET } = await import('@/app/brand-card.png/route');
    const first = await GET();
    const body = await png(first);
    expect(first.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(first.headers.get('x-robots-tag')).toBe('noindex');
    for (const fetcher of Object.values(api)) expect(fetcher).not.toHaveBeenCalled();
    // The second answer is the same picture, from memory.
    const second = await GET();
    expect(Buffer.from(await second.arrayBuffer()).equals(body)).toBe(true);
    expect(second.headers.get('content-type')).toBe('image/png');
  }, 20_000);
});

describe('the card routes read English names on any locale', () => {
  beforeEach(() => {
    for (const fetcher of Object.values(api)) fetcher.mockReset().mockResolvedValue(UNREACHABLE);
  });

  it('the match card', async () => {
    const { default: Image } = await import('@/app/[locale]/match/[id]/opengraph-image');
    await png(await Image({ params: Promise.resolve({ locale: 'fa', id: ID }) }));
    expect(api.fetchMatchCentre).toHaveBeenCalledWith(ID, 'en');
  }, 20_000);

  it('the competition card', async () => {
    const { default: Image } = await import('@/app/[locale]/competition/[id]/opengraph-image');
    await png(await Image({ params: Promise.resolve({ locale: 'fa', id: ID }) }));
    expect(api.fetchCompetition).toHaveBeenCalledWith(ID, '', 'en');
  }, 20_000);

  it('the team card, kept an hour by shared caches (T-1826)', async () => {
    const { default: Image } = await import('@/app/[locale]/team/[id]/opengraph-image');
    const drawn = await Image({ params: Promise.resolve({ locale: 'fa', id: ID }) });
    await png(drawn);
    expect(drawn.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(drawn.headers.get('x-robots-tag')).toBe('noindex');
    expect(api.fetchTeam).toHaveBeenCalledWith(ID, 'en');
    // Its address ends in .png, which Cloudflare's edge caches (PR #888 review).
    const { generateImageMetadata } = await import('@/app/[locale]/team/[id]/opengraph-image');
    expect((await generateImageMetadata({ params: { locale: 'fa' } }))[0]?.id).toBe('card.png');
  }, 20_000);

  it('the member card', async () => {
    api.fetchProfile.mockResolvedValue({
      ok: true,
      data: { kind: 'visible', profile: { display_name: 'Someone', username: 'someone' } },
    });
    const { default: Image } = await import('@/app/[locale]/u/[username]/opengraph-image');
    await png(await Image({ params: Promise.resolve({ locale: 'fa', username: 'someone' }) }));
    expect(api.fetchPredictionHistory).toHaveBeenCalledWith(
      'someone',
      'limit=20&offset=0&locale=en',
      undefined,
    );
  }, 20_000);
});
