import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ForecastPanel } from '@/components/forecast-panel';
import { LiveMatch } from '@/components/live-match';
import { PredictionSection } from '@/components/prediction-section';
import {
  fetchEvaluations,
  fetchForecasts,
  fetchMatchCentre,
  fetchMe,
  fetchOwnPrediction,
} from '@/lib/api';
import { isTimeZone } from '@/lib/scores';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: 'Match · FMIP' };
  const result = await fetchMatchCentre(id);
  if (!result.ok) return { title: 'Match · FMIP' };
  const f = result.data.fixture;
  return { title: `${f.home.name} v ${f.away.name} · FMIP` };
}

/**
 * The match centre page (blueprint 4.2, T-034). Works before, during and
 * after a match because every module comes with its coverage state and the
 * page renders whatever is there: a scheduled match shows the header, form
 * and head-to-head; a live one adds the timeline and clock and stays current
 * over SSE; a finished one shows the full record. An unknown id is a 404; an
 * unreachable API is said out loud.
 */
export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  const tzParam = typeof query.tz === 'string' ? query.tz : undefined;
  const timeZone =
    tzParam !== undefined && isTimeZone(tzParam)
      ? tzParam
      : me !== null && isTimeZone(me.timezone)
        ? me.timezone
        : 'UTC';

  const result = await fetchMatchCentre(id);
  if (!result.ok && result.status === 404) notFound();
  // The forecast (T-065) and, once the match is over, its evaluation (T-066).
  const [forecasts, evaluations, prediction] = result.ok
    ? await Promise.all([
        fetchForecasts(id),
        result.data.fixture.status === 'finished' ? fetchEvaluations(id) : Promise.resolve(null),
        fetchOwnPrediction(id, cookie),
      ])
    : [null, null, null];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <p className="text-sm">
        <Link href={`/${locale}/scores`} className="underline">
          ← Scores
        </Link>
        <span className="ms-3 opacity-70" data-testid="timezone">
          Times in {timeZone}
        </span>
      </p>
      {!result.ok ? (
        <>
          <h1 className="text-2xl font-semibold" data-testid="title">
            Match
          </h1>
          <p role="alert" data-testid="match-unreachable">
            The match service is unreachable right now, so this match cannot be shown.
          </p>
        </>
      ) : (
        <LiveMatch
          initial={result.data}
          timeZone={timeZone}
          panels={
            <>
              <PredictionSection
                locale={locale}
                fixture={result.data.fixture}
                me={me}
                current={prediction}
              />
              <ForecastPanel
                forecasts={forecasts !== null && forecasts.ok ? forecasts.data : null}
                evaluations={evaluations !== null && evaluations.ok ? evaluations.data : null}
                home={result.data.fixture.home.name}
                away={result.data.fixture.away.name}
                timeZone={timeZone}
              />
            </>
          }
        />
      )}
    </main>
  );
}
