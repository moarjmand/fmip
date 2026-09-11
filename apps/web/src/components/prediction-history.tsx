import type { PredictionHistoryItem } from '@fmip/contracts';
import Link from 'next/link';
import {
  type SettlementTone,
  fixtureLabel,
  formatSubmitted,
  historyPageCount,
  settlementLabel,
  versionLabel,
} from '@/lib/prediction-history';

const TONE_CLASS: Record<SettlementTone, string> = {
  correct: 'font-semibold',
  wrong: 'opacity-80',
  void: 'italic opacity-70',
  pending: 'opacity-70',
  open: 'opacity-70',
};

/**
 * A member's prediction history (blueprint 7.2, T-056): per match, the
 * version that stands as it was submitted, when, and how it settled. Every
 * version is kept (rule 5 for predictions), so the count of versions is shown
 * and the earlier ones are one disclosure away.
 */
export function PredictionHistory({
  locale,
  timeZone,
  items,
  total,
  page,
  pageHref,
}: {
  locale: string;
  timeZone: string;
  items: PredictionHistoryItem[];
  total: number;
  page: number;
  pageHref: (page: number) => string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm opacity-70" data-testid="history-empty">
        {page > 1 ? 'No predictions on this page.' : 'No predictions yet.'}
      </p>
    );
  }
  const pages = historyPageCount(total);

  return (
    <div className="flex flex-col gap-3" data-testid="prediction-history">
      <ol className="flex flex-col divide-y divide-current/10">
        {items.map(({ fixture, prediction }) => {
          const stands = settlementLabel(prediction);
          return (
            <li key={prediction.id} className="flex flex-col gap-1 py-3" data-testid="history-item">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
                  {fixtureLabel(fixture)}
                </Link>
                <span className="text-xs opacity-70">
                  {fixture.competition.name} ·{' '}
                  <time dateTime={fixture.kickoff_at}>
                    {formatSubmitted(fixture.kickoff_at, timeZone)}
                  </time>
                </span>
              </div>
              <p className="text-sm" data-testid="history-version">
                <span className="me-2 rounded border border-current/30 px-1 text-xs">
                  v{prediction.latest.version_number}
                </span>
                {versionLabel(prediction.latest)}
                <span className="ms-2 text-xs opacity-70">
                  submitted{' '}
                  <time dateTime={prediction.latest.submitted_at}>
                    {formatSubmitted(prediction.latest.submitted_at, timeZone)}
                  </time>
                </span>
              </p>
              <p className={`text-sm ${TONE_CLASS[stands.tone]}`} data-testid="history-settlement">
                {stands.text}
                {prediction.settlement?.actual != null && (
                  <span className="ms-2 text-xs opacity-70">
                    full time {prediction.settlement.actual.home}–
                    {prediction.settlement.actual.away}
                  </span>
                )}
              </p>
              {prediction.versions.length > 1 && (
                <details className="text-xs opacity-80">
                  <summary>
                    {prediction.versions.length - 1} earlier{' '}
                    {prediction.versions.length === 2 ? 'version' : 'versions'}
                  </summary>
                  <ul className="ms-4 mt-1 flex flex-col gap-1">
                    {prediction.versions
                      .filter((v) => v.id !== prediction.latest.id)
                      .map((v) => (
                        <li key={v.id}>
                          v{v.version_number} · {versionLabel(v)} ·{' '}
                          <time dateTime={v.submitted_at}>
                            {formatSubmitted(v.submitted_at, timeZone)}
                          </time>
                        </li>
                      ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>

      {pages > 1 && (
        <nav aria-label="History pages" className="flex flex-wrap items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="underline">
              Newer
            </Link>
          )}
          <span className="opacity-70">
            Page {page} of {pages} · {total} predictions
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="underline">
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
