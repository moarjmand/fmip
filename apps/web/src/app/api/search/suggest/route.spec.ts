import { NO_MEDIA } from '@fmip/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `GET /api/search/suggest` (T-1844, D-435): only a term and a locale the
 * route takes are asked, no cookie goes with them, a failure is said as one
 * and never kept, and an answer may be kept for a minute.
 */

const api = vi.hoisted(() => ({ fetchSearch: vi.fn() }));
vi.mock('@/lib/api', () => api);

const { GET } = await import('./route');

const ask = (query: string) => GET(new Request(`https://example.test/api/search/suggest?${query}`));

describe('the suggestions route', () => {
  beforeEach(() => api.fetchSearch.mockReset());

  it('refuses a term too short or too long, and a locale that is not ours, asking nothing', async () => {
    for (const query of [
      'q=a&locale=en',
      `q=${'x'.repeat(65)}&locale=en`,
      'q=arsenal&locale=xx',
      'q=arsenal',
    ]) {
      const response = await ask(query);
      expect(response.status, query).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(api.fetchSearch).not.toHaveBeenCalled();
  });

  it('answers the groups in the reader language, asked without a cookie, kept a minute', async () => {
    api.fetchSearch.mockResolvedValue({
      ok: true,
      status: 200,
      setCookie: null,
      data: {
        query: 'ars',
        types: ['team', 'competition', 'person'],
        results: [
          {
            type: 'team',
            id: 't1',
            name: 'Arsenal',
            secondary: 'England',
            matched_on: 'name',
            alias: null,
            score: 1,
            image: NO_MEDIA,
          },
        ],
        stories: null,
        groups: null,
        members: null,
      },
    });
    const response = await ask('q=ars&locale=fa');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(api.fetchSearch).toHaveBeenCalledTimes(1);
    expect(api.fetchSearch.mock.calls[0]).toHaveLength(1);
    expect(api.fetchSearch.mock.calls[0]![0]).toContain('locale=fa');
    const body = (await response.json()) as {
      term: string;
      groups: { rows: { href: string }[] }[];
    };
    expect(body.term).toBe('ars');
    expect(body.groups[0]!.rows[0]!.href).toBe('/fa/team/t1');
  });

  it('says the API could not be reached, and keeps nothing', async () => {
    api.fetchSearch.mockResolvedValue({ ok: false, status: 0, error: null, setCookie: null });
    const response = await ask('q=ars&locale=en');
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'unavailable' });
  });
});
