import { drawSocialCard, noSocialCard } from '@/components/social-card-image';
import { fetchSocialCard, isSocialPostId } from '@/lib/social-card';

/**
 * A social post's picture (T-1835, D-427 point 11), 1080 x 1350, drawn from
 * the post's frozen payload alone -- so what a person approved in the console
 * is the picture the publisher sends. Not under a locale: the words are
 * English on every card. The address ends in `.png` so Cloudflare keeps it
 * (it caches by extension) -- for good once the post is published, and not
 * at all before, so a post rejected after its preview answers 404 at the edge
 * too.
 *
 * 404 for an id that is not a UUID and for the API's 404 (an unknown post, a
 * `rejected`, `expired` or `superseded` one); 503 for any other failure (the
 * API unreachable, a 429 or 403 on the way, the renderer failing) -- never
 * the plain card in its place, because a post must not go out with the wrong
 * picture, and never a 404 for what may be a passing fault. Never indexed.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isSocialPostId(id)) return noSocialCard(404);
  const result = await fetchSocialCard(id);
  if (!result.ok) return noSocialCard(result.status === 404 ? 404 : 503);
  return drawSocialCard(result.data.payload, result.data.published);
}
