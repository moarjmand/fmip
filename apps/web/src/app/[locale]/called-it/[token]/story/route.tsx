import { drawCalledIt, noCard, PUBLIC_CARD_CACHE } from '@/components/draw-called-it';
import { fetchPredictionShare } from '@/lib/api';

/**
 * The public link's picture for a phone's story (T-1723, D-351), 1080 x 1920:
 * the same card, laid out tall. Drawn from the token alone, like `card`.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; token: string }> },
): Promise<Response> {
  const { token } = await params;
  const result = await fetchPredictionShare(token);
  if (!result.ok) return noCard(result);
  return drawCalledIt(result.data.card, 'story', PUBLIC_CARD_CACHE);
}
