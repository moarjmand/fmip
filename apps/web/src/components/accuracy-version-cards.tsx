import type {
  AccuracyPeriod,
  PublicModelAccuracyResponse,
  PublicVersionSeries,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { formatDate, formatGregorianMonth, formatNumber } from '@/i18n/format';
import type { Locale } from '@/i18n/locales';
import { interpolate, message, plural, t } from '@/i18n/messages';
import { formatEdge } from '@/lib/accuracy-edge';
import { type VersionCard, versionCards } from '@/lib/accuracy-calibration';
import { filled, formatFixed, formatPercent } from '@/lib/words';

/**
 * "Each model version on its own" (T-1751, D-370 point 11, D-408; board
 * P3-6): one card a published version, newest first, each with its own
 * coverage state (rule 3). Each match is counted once, under the version of
 * its last forecast before kick-off, so the cards add up to the opening
 * card's matches. A version at or over the sample rule shows its matches,
 * how often it was right and its edge over a guess, with the RPS it is
 * computed from; under it, the badge, the count and the early-record
 * sentence, and no figure claimed. A shadow candidate is never here: the API
 * serves published versions only.
 */

/** A period as a reader names it: "October 2026", or "the week of 12 Oct 2026". */
function periodName(lang: Locale, start: string, period: AccuracyPeriod): string {
  if (period === 'month') return formatGregorianMonth(lang, start.slice(0, 7));
  return interpolate(t(lang, 'modelAccuracy.weekOf'), {
    date: formatDate(lang, `${start}T00:00:00Z`, 'UTC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  });
}

function Figure({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-caption">{label}</dt>
      <dd className="flex flex-col">
        <span className="text-xl leading-tight font-extrabold font-stretch-condensed tabular-nums">
          {value}
        </span>
        {note}
      </dd>
    </div>
  );
}

function Card({
  lang,
  card,
  period,
  minimum,
}: {
  lang: Locale;
  card: VersionCard;
  period: AccuracyPeriod;
  minimum: number;
}) {
  const { series, edge, first, last } = card;
  const total = series.total;
  const span =
    first === null || last === null
      ? null
      : first === last
        ? filled(message(lang, 'modelAccuracy.versionCards.spanOne'), {
            first: periodName(lang, first, period),
          })
        : filled(message(lang, 'modelAccuracy.versionCards.span'), {
            first: periodName(lang, first, period),
            last: periodName(lang, last, period),
          });
  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-tile border border-default bg-surface p-4 sm:p-5"
      // No version name in an attribute: "name@x.y.z" as one run is what
      // Cloudflare's Email Obfuscation rewrites (T-1580).
      data-testid="accuracy-version"
      data-coverage={total.coverage}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 font-mono text-sm font-bold" dir="ltr">
          <ModelVersion version={series.model_version} />
        </h3>
        {total.coverage !== 'available' && (
          <CoverageBadge
            state={total.coverage}
            label={<Translated locale={lang} message={COVERAGE_KEY[total.coverage]} />}
          />
        )}
      </div>
      {span !== null && (
        <p className="text-xs text-muted" data-testid="accuracy-version-span">
          <MessageText message={span} />
        </p>
      )}
      {total.coverage === 'not_supplied' || total.matches === 0 ? (
        <p className="text-sm text-muted" data-testid="accuracy-version-none">
          <Translated locale={lang} message="modelAccuracy.versionCards.none" />
        </p>
      ) : total.coverage === 'limited' || edge === null ? (
        // Under the sample rule: the count and the sentence, no figure claimed.
        <p className="text-sm text-fg" data-testid="accuracy-version-limited">
          <MessageText
            message={plural(lang, 'modelAccuracy.versionCards.limited', total.matches, {
              minimum: formatNumber(lang, minimum),
            })}
          />
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3" data-testid="accuracy-version-figures">
          <Figure
            label={<Translated locale={lang} message="modelAccuracy.table.matches" />}
            value={formatNumber(lang, total.matches)}
          />
          <Figure
            label={<Translated locale={lang} message="modelAccuracy.table.correct" />}
            value={total.accuracy === null ? '—' : formatPercent(lang, total.accuracy * 100)}
          />
          <Figure
            label={<Translated locale={lang} message="modelAccuracy.weekly.edge" />}
            value={<bdi dir="ltr">{formatEdge(lang, edge.percent)}</bdi>}
          />
          {/* The two figures the edge is computed from, as printed (D-370 point 3). */}
          <Figure
            label={<Translated locale={lang} message="modelAccuracy.table.rps" />}
            value={formatFixed(lang, edge.model, 3)}
            note={
              <span className="text-xs text-muted tabular-nums">
                <MessageText
                  message={filled(message(lang, 'modelAccuracy.kpi.guess'), {
                    value: formatFixed(lang, edge.guess, 3),
                  })}
                />
              </span>
            }
          />
        </dl>
      )}
    </li>
  );
}

export function VersionCards({
  lang,
  report,
}: {
  lang: Locale;
  report: PublicModelAccuracyResponse;
}) {
  const cards = versionCards(report.versions satisfies PublicVersionSeries[]);
  if (cards.length === 0) return null;
  return (
    <section
      aria-labelledby="accuracy-versions-heading"
      className="flex flex-col gap-3"
      data-testid="accuracy-versions-split"
    >
      <h2
        id="accuracy-versions-heading"
        className="text-lg font-extrabold font-stretch-semi-expanded sm:text-xl"
      >
        <Translated locale={lang} message="modelAccuracy.versionCards.title" />
      </h2>
      <p className="max-w-measure text-sm text-muted">
        <Translated locale={lang} message="modelAccuracy.versionCards.lede" />
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <Card
            key={card.series.model_version}
            lang={lang}
            card={card}
            period={report.period}
            minimum={report.minimum_matches}
          />
        ))}
      </ul>
    </section>
  );
}
