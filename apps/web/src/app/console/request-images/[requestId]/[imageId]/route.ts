import { consoleRaw } from '@/lib/console-api';
import { PASSED_HEADERS, PICTURE_ID } from '../../picture-route';

/**
 * A teammate request's picture (T-1731, D-357), or with `?size=thumb` its
 * thumbnail, for the console's page: asked of the API with the console's
 * cookie and streamed through with its headers (`private`, inline,
 * `nosniff`, the sandbox policy). Without a console session the API answers
 * 401 and so does this; the pictures have no public address.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string; imageId: string }> },
): Promise<Response> {
  const { requestId, imageId } = await params;
  if (!PICTURE_ID.test(requestId) || !PICTURE_ID.test(imageId))
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const thumb = new URL(request.url).searchParams.get('size') === 'thumb';
  const upstream = await consoleRaw(
    `requests/${requestId}/images/${imageId}${thumb ? '/thumb' : ''}`,
    { signal: request.signal },
  );
  if (upstream === null)
    return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
  if (upstream.status !== 200)
    return new Response(null, {
      status: upstream.status === 401 || upstream.status === 404 ? upstream.status : 502,
      headers: { 'cache-control': 'no-store' },
    });
  const headers = new Headers();
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(upstream.body, { status: 200, headers });
}
