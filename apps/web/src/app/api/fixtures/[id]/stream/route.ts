import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The browser's end of one match centre's stream (T-034): the page's
 * EventSource connects here and this handler holds the connection to the
 * API's `/fixtures/:id/stream` (D-027). No session is needed: the match
 * centre is public.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'not_found', message: 'No such fixture.' }, { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/fixtures/${id.toLowerCase()}/stream`, {
      headers: { accept: 'text/event-stream' },
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return NextResponse.json(
      { error: 'unavailable', message: 'The match service is unreachable.' },
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
