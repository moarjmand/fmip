import { permanentRedirect } from 'next/navigation';
import { predictionsRedirect } from '@/lib/scores';

export const dynamic = 'force-dynamic';

/**
 * The old Predictions page (T-137, D-201) is gone (T-1519, D-269): matches
 * and picks are one page (D-268), the founder's analysis is on it at
 * `#analysis`, and the leaderboard and the model's record are linked from
 * there. An old address -- a bookmark, a shared link, a search result --
 * lands on the matches page with its day, zone and competition; the browser
 * carries a `#analysis` fragment across the redirect itself.
 */
export default async function PredictionsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  permanentRedirect(predictionsRedirect(locale, query));
}
