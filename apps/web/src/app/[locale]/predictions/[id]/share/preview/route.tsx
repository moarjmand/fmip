import { drawCalledIt, noCard, PRIVATE_CARD_CACHE } from '@/components/draw-called-it';
import { fetchOwnPredictionShare } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The owner's own preview of their card (T-1723, D-351), before they decide
 * to share it: drawn only for the signed-in member whose prediction it is
 * (the API answers 404 to anyone else, and 401 without a session), and never
 * cached anywhere shared. Nothing here makes anything public.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> },
): Promise<Response> {
  const { id } = await params;
  const result = await fetchOwnPredictionShare(id, await sessionCookieHeader());
  if (!result.ok) return noCard(result);
  if (result.data.kind !== 'called') {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return drawCalledIt(result.data.card, 'card', PRIVATE_CARD_CACHE);
}
