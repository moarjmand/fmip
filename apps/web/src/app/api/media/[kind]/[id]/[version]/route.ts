const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';

/** The headers the API sets on an image that the reader's browser needs too. */
const PASSED = [
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'x-content-type-options',
  'content-security-policy',
] as const;

/**
 * A stored crest, logo or photo on the site's own origin (T-1320, D-176). The
 * contracts name `/api/media/<kind>/<id>/<version>`; this handler asks the
 * API's `/media/...` over the internal network and passes the bytes and the
 * caching headers through, so a reader's browser never asks the provider --
 * or anyone but this site -- for an image (the rule D-089 set for fonts).
 * Cloudflare keeps the immutable answers at the edge, so this runs about once
 * per image per edge.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string; version: string }> },
): Promise<Response> {
  const { kind, id, version } = await params;
  const path = [kind, id, version].map(encodeURIComponent).join('/');
  const headers: Record<string, string> = {};
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch !== null) headers['if-none-match'] = ifNoneMatch;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/media/${path}`, {
      headers,
      cache: 'no-store',
      signal: request.signal,
    });
  } catch {
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const out = new Headers();
  for (const name of PASSED) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  if (upstream.status !== 200 && upstream.status !== 304) {
    // A missing image is not cached for long: it may be fetched within minutes.
    out.set('cache-control', 'public, max-age=300');
    return new Response(null, { status: upstream.status === 404 ? 404 : 502, headers: out });
  }
  return new Response(upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
