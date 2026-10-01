import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The page's language, as the locale proxy forwards it (T-1312).
let reader: string | null = 'fa';
vi.mock('next/headers', () => ({
  headers: async () => new Headers(reader === null ? {} : { 'x-fmip-locale': reader }),
}));

const { fetchAdminOverview, fetchCompetition, fetchMatchCentre, fetchScores } =
  await import('./api');

describe('the API client asks for names in the reader language (T-1312)', () => {
  const urls: string[] = [];

  beforeEach(() => {
    urls.length = 0;
    reader = 'fa';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response('{}', { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('passes the reader locale on the scores list and the match centre', async () => {
    await fetchScores('from=2026-10-01&tz=Asia%2FTehran', undefined);
    await fetchMatchCentre('abc');
    expect(urls[0]).toMatch(/\/scores\?from=2026-10-01&tz=Asia%2FTehran&locale=fa$/);
    expect(urls[1]).toMatch(/\/fixtures\/abc\?locale=fa$/);
  });

  it('keeps a locale the caller chose, and leaves the console in English', async () => {
    await fetchCompetition('c1', '', 'ar');
    await fetchAdminOverview(undefined);
    expect(urls[0]).toMatch(/locale=ar$/);
    expect(urls[0]).not.toMatch(/locale=fa/);
    expect(urls[1]).toMatch(/\/admin\/overview$/);
  });

  it('asks for English too (D-178), and for nothing outside a page request', async () => {
    reader = 'en';
    await fetchMatchCentre('abc');
    reader = null;
    await fetchMatchCentre('abc');
    expect(urls[0]).toMatch(/\/fixtures\/abc\?locale=en$/);
    expect(urls[1]).toMatch(/\/fixtures\/abc$/);
  });
});
