import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiHealth } from '@/lib/api';

const fetchApiHealth = vi.fn<() => Promise<ApiHealth>>();
vi.mock('@/lib/api', () => ({ fetchApiHealth: () => fetchApiHealth() }));

const { GET, API_HEALTH_TIMEOUT_MS } = await import('./route');

const report = {
  status: 'ok' as const,
  service: 'api' as const,
  uptime_seconds: 123.4,
  started_at: '2026-09-30T08:00:00.000Z',
  checked_at: '2026-09-30T09:00:00.000Z',
};

describe('GET /health (T-806)', () => {
  beforeEach(() => {
    fetchApiHealth.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('answers 200 with only the status and when it was checked when the API is up', async () => {
    fetchApiHealth.mockResolvedValue({ reachable: true, report });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', checked_at: report.checked_at });
  });

  it('answers 503 when the API cannot be reached', async () => {
    fetchApiHealth.mockResolvedValue({ reachable: false });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { status: string; checked_at: string };
    expect(body.status).toBe('unavailable');
    expect(Number.isNaN(Date.parse(body.checked_at))).toBe(false);
  });

  it('answers 503 when the API reports anything but ok', async () => {
    fetchApiHealth.mockResolvedValue({
      reachable: true,
      report: { ...report, status: 'degraded' as unknown as 'ok' },
    });

    expect((await GET()).status).toBe(503);
  });

  it('answers 503 when the API does not answer in time', async () => {
    vi.useFakeTimers();
    fetchApiHealth.mockReturnValue(new Promise<ApiHealth>(() => undefined));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(API_HEALTH_TIMEOUT_MS);

    expect((await pending).status).toBe(503);
  });

  it('is left alone by the locale proxy, so it is never redirected', () => {
    const proxy = readFileSync(fileURLToPath(new URL('../../proxy.ts', import.meta.url)), 'utf8');
    expect(proxy).toMatch(/matcher: \['\/\(\(\?!_next\/\|api\/\|health\$\|/);
  });
});
