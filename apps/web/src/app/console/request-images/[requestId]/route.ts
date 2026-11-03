import { CONSOLE_REQUEST_IMAGE_MAX_BYTES } from '@fmip/contracts/console';
import { consoleRaw } from '@/lib/console-api';
import { isConsoleUpload, PICTURE_ID } from '../picture-route';

/**
 * A picture for a teammate request (T-1731, D-357), from the console's own
 * page: the browser sends the file's bytes here (`XMLHttpRequest`, for the
 * progress bar) and this hands them to the API's
 * `POST /console/requests/:id/images` with the console's cookie. A server
 * action cannot carry it: its body is capped at 1 MB and reports no progress.
 *
 * Only the console's page may post: the cookie is `SameSite=Strict`, the
 * origin must be this host, and the page sets a header no other site's form
 * can send. The size is checked before the body is read; the API checks it
 * again, with everything else.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
): Promise<Response> {
  const { requestId } = await params;
  if (!PICTURE_ID.test(requestId)) return answer(404, 'No such request.');
  if (!isConsoleUpload(request.headers)) return answer(403, 'This upload is not from the console.');
  const stated = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isFinite(stated) || stated > CONSOLE_REQUEST_IMAGE_MAX_BYTES)
    return answer(413, 'A picture is at most 8 MB.');
  const body = await request.arrayBuffer();
  if (body.byteLength > CONSOLE_REQUEST_IMAGE_MAX_BYTES)
    return answer(413, 'A picture is at most 8 MB.');
  const caption = new URL(request.url).searchParams.get('caption');
  const upstream = await consoleRaw(
    `requests/${requestId}/images${caption ? `?caption=${encodeURIComponent(caption)}` : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', accept: 'application/json' },
      body,
      signal: request.signal,
    },
  );
  if (upstream === null) return answer(503, '');
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function answer(status: number, message: string): Response {
  return Response.json(
    { error: status === 404 ? 'not_found' : 'validation', message },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
