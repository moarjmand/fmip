import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/set-cookie';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

/**
 * The browser's end of the scores stream (T-032). The page's EventSource
 * connects here, on the web origin, and this handler holds the matching
 * connection to the API's `/scores/stream`, forwarding the member's session
 * cookie so favourites are pinned in the live picture too (D-027). Bytes pass
 * through untouched; the SSE framing is the API's.
 *
 * When the API cannot be reached the answer is a 503 with a JSON error, which
 * EventSource reports as an error and the page shows as "unavailable".
 */
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).search;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (session !== undefined && session !== '') {
    headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(session)}`;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/scores/stream${query}`, {
      headers,
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return NextResponse.json(
      { error: 'unavailable', message: 'The scores service is unreachable.' },
      { status: 503 },
    );
  }

  if (!upstream.ok || upstream.body === null) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
