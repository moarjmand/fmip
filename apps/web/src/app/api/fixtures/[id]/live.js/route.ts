import { liveAnswer } from '@/lib/live-modules-server';

export const dynamic = 'force-dynamic';

/**
 * The match centre's moving modules, drawn again for a live page (D-422,
 * amending D-409 point 2): `GET /api/fixtures/:id/live.js?b&locale&parts&tz`,
 * written by `liveModulesPath`. Public: no cookie, no reader header, no
 * personal data; the same bytes for every reader of the match in one locale
 * and zone asking for the same parts. Cloudflare keeps an answer for two
 * seconds (its path ends in a cached extension, T-1461), so a goal costs the
 * origin about one answer per key whatever the audience; the origin shares
 * one read and one drawing for the same two seconds (`liveAnswer`).
 *
 * Only a query written exactly as the page writes it is answered (review
 * R2-B1): the key space is fixtures x our locales x canonical zones x three
 * parts x this process, nothing a client can grow. A `b` from another server
 * process gets a `409` reload signal. Anything but a 200 is never kept.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { status, body } = await liveAnswer(id, new URL(request.url).search);
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': status === 200 ? 'public, max-age=2, s-maxage=2' : 'no-store',
    },
  });
}
