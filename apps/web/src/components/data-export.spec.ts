import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiError, DataExport } from '@fmip/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';
import {
  DATA_EXPORT_REFUSALS,
  REFUSAL_MESSAGES,
  refusalFromQuery,
  refusalOf,
} from '@/lib/data-export';

/**
 * Download my data on the page (T-846, D-158). The API spec proves what the
 * file holds and that it holds nothing of another member's; here, that the
 * page asks for the password, that the route hands the file to this browser
 * only and sends every refusal back with its reason, and that a form from
 * another site gets nothing.
 */
const apiRequest = vi.fn();
const session = { cookie: 'fmip_session=abc' as string | undefined };
vi.mock('@/lib/api', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock('@/lib/session', () => ({
  sessionCookieHeader: async () => session.cookie,
  readerAddress: async () => '203.0.113.9',
}));

const { POST } = await import('../app/[locale]/settings/data-export/route');

const HERE = __dirname;
const SETTINGS = readFileSync(join(HERE, '..', 'app', '[locale]', 'settings', 'page.tsx'), 'utf8');

function post(password: string | null, origin = 'http://web.test'): Promise<Response> {
  const body = new FormData();
  if (password !== null) body.set('password', password);
  const request = new Request('http://web.test/en/settings/data-export', {
    method: 'POST',
    body,
    headers: { origin, host: 'web.test' },
  });
  return POST(request, { params: Promise.resolve({ locale: 'en' }) });
}

const refused = (status: number, error: ApiError | null) => ({
  ok: false,
  status,
  error,
  setCookie: null,
});

describe('the refusals', () => {
  it('tell a wrong password, the daily rule and the password ceilings apart', () => {
    expect(refusalOf(400, { error: 'validation', message: '' })).toBe('password');
    expect(refusalOf(401, { error: 'unauthenticated', message: '' })).toBe('signed_out');
    expect(
      refusalOf(429, {
        error: 'rate_limited',
        message: '',
        fields: { export: 'one copy per day' },
      }),
    ).toBe('daily');
    expect(refusalOf(429, { error: 'rate_limited', message: '' })).toBe('limited');
    expect(refusalOf(0, null)).toBe('unavailable');
    expect(refusalOf(500, null)).toBe('unavailable');
  });

  it('read back from the query only when they are ours', () => {
    for (const value of DATA_EXPORT_REFUSALS) expect(refusalFromQuery(value)).toBe(value);
    expect(refusalFromQuery('<script>')).toBeNull();
    expect(refusalFromQuery(['password'])).toBeNull();
    expect(refusalFromQuery(undefined)).toBeNull();
  });
});

describe('the route', () => {
  beforeEach(() => {
    apiRequest.mockReset();
    session.cookie = 'fmip_session=abc';
  });

  it('hands the file to this browser as an attachment, never cached', async () => {
    const data = {
      format: 'fmip-data-export@1',
      generated_at: '2026-09-30T10:00:00+00:00',
      account: { username: 'kaveh' },
    } as unknown as DataExport;
    apiRequest.mockResolvedValue({ ok: true, status: 200, data, setCookie: null });
    const response = await post('the password');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="fmip-data-kaveh-2026-09-30.json"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await response.text())).toEqual(data);
    expect(apiRequest).toHaveBeenCalledWith('/auth/account/export', {
      method: 'POST',
      body: { password: 'the password' },
      cookie: 'fmip_session=abc',
      clientIp: '203.0.113.9',
    });
  });

  it.each([
    [
      refused(400, { error: 'validation', message: '', fields: { password: 'is not right' } }),
      'password',
    ],
    [
      refused(429, { error: 'rate_limited', message: '', fields: { export: 'one copy per day' } }),
      'daily',
    ],
    [refused(429, { error: 'rate_limited', message: '' }), 'limited'],
    [refused(0, null), 'unavailable'],
  ])('sends a refusal back to the section with its reason (%#)', async (result, reason) => {
    apiRequest.mockResolvedValue(result);
    const response = await post('the password');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/en/settings?export=${reason}#download-data`);
  });

  it('asks the API nothing for a guest, an empty password, or a form from another site', async () => {
    session.cookie = undefined;
    expect((await post('the password')).headers.get('location')).toContain('export=signed_out');
    session.cookie = 'fmip_session=abc';
    expect((await post('')).headers.get('location')).toContain('export=password');
    expect((await post(null)).headers.get('location')).toContain('export=password');
    // The scheme is not compared (behind the proxy the handler sees http).
    apiRequest.mockResolvedValue(refused(0, null));
    expect((await post('the password', 'https://web.test')).headers.get('location')).toContain(
      'export=unavailable',
    );
    apiRequest.mockReset();
    const foreign = await post('the password', 'https://elsewhere.example');
    expect(foreign.status).toBe(303);
    expect(foreign.headers.get('location')).toContain('export=signed_out');
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('the section', () => {
  const section = SETTINGS.slice(SETTINGS.indexOf('function DataExportSection'));

  it('is a plain form to the route, asking for the password', () => {
    expect(section).toContain('method="post"');
    expect(section).toContain('action={`/${locale}/settings/data-export`}');
    expect(section).toContain('name="password"');
    expect(section).toContain('type="password"');
    expect(section).toContain('autoComplete="current-password"');
    expect(section).toContain('id="download-data"');
  });

  it('is rendered for a member only, before deletion', () => {
    const guestBranchEnds = SETTINGS.indexOf('const { profile, account, privacy');
    const at = SETTINGS.indexOf('<DataExportSection');
    expect(at).toBeGreaterThan(guestBranchEnds);
    expect(at).toBeLessThan(SETTINGS.indexOf('<DeleteAccountSection'));
  });

  it('has every string in the catalogue', () => {
    const keys = [
      'account.export.heading',
      'account.export.contents',
      'account.export.others',
      'account.export.once',
      'account.export.password',
      'account.export.submit',
      ...DATA_EXPORT_REFUSALS.map((r) => REFUSAL_MESSAGES[r]),
    ];
    for (const key of keys) expect(EN[key as keyof typeof EN], key).toBeTruthy();
  });
});
