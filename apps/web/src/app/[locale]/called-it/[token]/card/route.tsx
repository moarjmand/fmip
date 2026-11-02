import { drawCalledIt, noCard, PUBLIC_CARD_CACHE } from '@/components/draw-called-it';
import { fetchPredictionShare } from '@/lib/api';

/**
 * The public link's picture (T-1723, D-351), 1200 x 630: what a chat preview
 * shows and what the share sheet attaches. Drawn from the token alone; the
 * same 404 for a token that is unknown, revoked or no longer a correct pick.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; token: string }> },
): Promise<Response> {
  const { token } = await params;
  const result = await fetchPredictionShare(token);
  if (!result.ok) return noCard(result);
  return drawCalledIt(result.data.card, 'card', PUBLIC_CARD_CACHE);
}
