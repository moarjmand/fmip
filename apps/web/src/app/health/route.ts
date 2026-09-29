import { NextResponse } from 'next/server';
import { fetchApiHealth, type ApiHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** How long the API gets to answer before this route reports it down. */
export const API_HEALTH_TIMEOUT_MS = 5_000;

export interface PublicHealth {
  status: 'ok' | 'unavailable';
  /** ISO 8601: when this answer was produced (the API's own clock when it answered). */
  checked_at: string;
}

/**
 * The public origin's health, for the off-machine uptime check (T-806, D-156).
 *
 * `GET /health` on the site answers here rather than being redirected to a
 * locale (the proxy's matcher leaves this path alone). It asks the API's own
 * liveness endpoint over the compose network, the way every server fetch does
 * (D-027), so one 200 proves Caddy, the web app and the API all answer.
 *
 * The body carries only the overall status and the moment it was checked:
 * nothing the API's own public health does not already say, and no uptime,
 * versions or addresses. 503 when the API cannot be reached in time or does
 * not report `ok` -- the outside check fails on anything but 200.
 */
export async function GET(): Promise<Response> {
  const health = await withTimeout(fetchApiHealth(), API_HEALTH_TIMEOUT_MS);
  const healthy = health.reachable && health.report.status === 'ok';

  const body: PublicHealth = healthy
    ? { status: 'ok', checked_at: health.report.checked_at }
    : { status: 'unavailable', checked_at: new Date().toISOString() };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}

function withTimeout(pending: Promise<ApiHealth>, ms: number): Promise<ApiHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ApiHealth>((resolve) => {
    timer = setTimeout(() => resolve({ reachable: false }), ms);
  });
  return Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
}
