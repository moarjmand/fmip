import type { PredictionHistoryItem } from '@fmip/contracts';
import Link from 'next/link';
import { LtrNumeric } from '@/components/score';
import { Translated } from '@/components/translated';
import { attribute, interpolate, message, t } from '@/i18n/messages';
import {
  type SettlementTone,
  fixtureLabel,
  formatSubmitted,
  historyPageCount,
  settlementLabel,
  versionLabel,
} from '@/lib/prediction-history';
import { asLocale, plainNumber, richMessage, scoreText } from '@/lib/prediction-text';

const TONE_CLASS: Record<SettlementTone, string> = {
  correct: 'font-semibold',
  wrong: 'text-muted',
  void: 'italic text-muted',
  pending: 'text-muted',
  open: 'text-muted',
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
  const l = asLocale(locale);
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="history-empty">
        <Translated locale={l} message={page > 1 ? 'history.emptyPage' : 'history.empty'} />
      </p>
    );
  }
  const pages = historyPageCount(total);
  const version = (n: number): string =>
    interpolate(t(l, 'predictions.versionShort'), { version: plainNumber(l, n) });
  const nav = attribute(l, 'history.pages');

  return (
    <div className="flex flex-col gap-3" data-testid="prediction-history">
      <ol className="flex flex-col divide-y divide-default">
        {items.map(({ fixture, prediction }) => {
          const stands = settlementLabel(prediction, l);
          return (
            <li key={prediction.id} className="flex flex-col gap-1 py-3" data-testid="history-item">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/${locale}/match/${fixture.id}`} className="font-medium underline">
                  {fixtureLabel(fixture, l)}
                </Link>
                <span className="text-xs text-muted">
                  {fixture.competition.name} ·{' '}
                  <time dateTime={fixture.kickoff_at}>
                    {formatSubmitted(locale, fixture.kickoff_at, timeZone)}
                  </time>
                </span>
              </div>
              <p className="text-sm" data-testid="history-version">
                <span className="me-2 rounded border border-default px-1 text-xs">
                  {version(prediction.latest.version_number)}
                </span>
                {versionLabel(prediction.latest, l)}
                <span className="ms-2 text-xs text-muted">
                  {richMessage(message(l, 'history.submitted'), {
                    time: (
                      <time dateTime={prediction.latest.submitted_at}>
                        {formatSubmitted(locale, prediction.latest.submitted_at, timeZone)}
                      </time>
                    ),
                  })}
                </span>
              </p>
              <p className={`text-sm ${TONE_CLASS[stands.tone]}`} data-testid="history-settlement">
                {stands.text}
                {prediction.settlement?.actual != null && (
                  <span className="ms-2 text-xs text-muted">
                    {richMessage(message(l, 'history.fullTime'), {
                      score: (
                        <LtrNumeric>
                          {scoreText(
                            l,
                            prediction.settlement.actual.home,
                            prediction.settlement.actual.away,
                          )}
                        </LtrNumeric>
                      ),
                    })}
                  </span>
                )}
              </p>
              {prediction.versions.length > 1 && (
                <details className="text-xs text-muted">
                  <summary>
                    <Translated
                      locale={l}
                      message="history.earlier"
                      count={prediction.versions.length - 1}
                    />
                  </summary>
                  <ul className="ms-4 mt-1 flex flex-col gap-1">
                    {prediction.versions
                      .filter((v) => v.id !== prediction.latest.id)
                      .map((v) => (
                        <li key={v.id}>
                          {version(v.version_number)} · {versionLabel(v, l)} ·{' '}
                          <time dateTime={v.submitted_at}>
                            {formatSubmitted(locale, v.submitted_at, timeZone)}
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
        <nav
          aria-label={nav.text}
          lang={nav.lang}
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="underline">
              <Translated locale={l} message="history.newer" />
            </Link>
          )}
          <span className="text-muted">
            <Translated
              locale={l}
              message="history.pageOf"
              count={total}
              params={{ page: plainNumber(l, page), pages: plainNumber(l, pages) }}
            />
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="underline">
              <Translated locale={l} message="history.older" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
