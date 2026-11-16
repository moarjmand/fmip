import { drawSocialCard, noSocialCard } from '@/components/social-card-image';
import { fetchSocialCard, isSocialPostId } from '@/lib/social-card';

/**
 * A social post's picture (T-1835, D-427 point 11), 1080 x 1350, drawn from
 * the post's frozen payload alone -- so what a person approved in the console
 * is the picture the publisher sends. Not under a locale: the words are
 * English on every card. The address ends in `.png` so Cloudflare keeps it
 * (it caches by extension), for good, since the payload never changes.
 *
 * 404 for an id that is not a UUID, an unknown post and a `rejected`,
 * `expired` or `superseded` one; 503 when the API cannot be asked or the
 * renderer fails -- never the plain card in its place, because a post must
 * not go out with the wrong picture. Never indexed.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isSocialPostId(id)) return noSocialCard(404);
  const result = await fetchSocialCard(id);
  if (!result.ok) return noSocialCard(result.status === 0 || result.status >= 500 ? 503 : 404);
  return drawSocialCard(result.data.payload);
}
