import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { fetchFounderDesk } = await import('./api');

/**
 * `fetchFounderDesk` (T-1791, D-393): the desk draws its form only on the
 * API's 204, which is the publish's own gate; a guest is not asked, and a
 * refusal or an unreachable API is "no".
 */
describe("the desk's question to the API", () => {
  const calls: { url: string; cookie: string | null }[] = [];
  let answer: () => Response = () => new Response(null, { status: 204 });

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, cookie: new Headers(init.headers).get('cookie') });
        return answer();
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is yes only on the 204, asked with the session', async () => {
    answer = () => new Response(null, { status: 204 });
    expect(await fetchFounderDesk('f1', 'fmip_session=x')).toBe(true);
    expect(calls[0]?.url).toMatch(/\/fixtures\/f1\/founder-analysis\/desk$/);
    expect(calls[0]?.cookie).toBe('fmip_session=x');
  });

  it('does not ask for a guest', async () => {
    expect(await fetchFounderDesk('f1', undefined)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('is no on a refusal and on an API that cannot be reached', async () => {
    answer = () =>
      new Response(JSON.stringify({ error: 'forbidden', message: 'No.' }), { status: 403 });
    expect(await fetchFounderDesk('f1', 'fmip_session=x')).toBe(false);
    answer = () => new Response(null, { status: 401 });
    expect(await fetchFounderDesk('f1', 'fmip_session=x')).toBe(false);
    answer = () => {
      throw new TypeError('fetch failed');
    };
    expect(await fetchFounderDesk('f1', 'fmip_session=x')).toBe(false);
  });
});
