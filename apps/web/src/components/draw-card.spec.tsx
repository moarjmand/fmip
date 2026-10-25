import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T-1506: a share card is drawn to the end before it is answered, and the
 * card routes ask the API for English names whatever the reader's language.
 */

const api = vi.hoisted(() => ({
  fetchMatchCentre: vi.fn(),
  fetchForecasts: vi.fn(),
  fetchCompetition: vi.fn(),
  fetchProfile: vi.fn(),
  fetchRating: vi.fn(),
  fetchPredictionHistory: vi.fn(),
}));
vi.mock('@/lib/api', () => api);

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
