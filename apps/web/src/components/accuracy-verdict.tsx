import type { PublicModelAccuracyResponse } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { COVERAGE_KEY } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { CoverageBadge } from '@/components/ui/coverage-badge';
import { formatDate, formatNumber } from '@/i18n/format';
import type { Locale } from '@/i18n/locales';
import { attribute, message, plural } from '@/i18n/messages';
import { edgeOverGuess, formatEdge, verdictState, type WeekBar } from '@/lib/accuracy-edge';
import { formatFixed, formatPercent } from '@/lib/words';

/**
 * The accuracy page's opening card (T-1750, D-370): two plain facts instead
 * of a score nobody outside the trade reads. How often the model picked the
 * right result, against a blind guess; and how much less error its
 * probabilities had than a guess of one third each, with the arithmetic
 * printed from the figures the page shows.
 *
 * **The sentence never ships alone.** "58% against 33%" flatters the model
 * (always picking the home side beats a third too), so the weakest-benchmark
 * warning is part of the same card, in the open, in the same state: no
 * stronger benchmark exists in the data and none is drawn or implied.
 *
 * Under the sample rule (`limited`) the card states the count and draws no
 * headline figure: 17% from a dozen matches is not a finding. With nothing
 * scored it says so and shows no figure (rule 3). Only the statistical
 * model, in its turquoise; the guess is grey and named (rule 6). Server
 * component, no script.
 */

/** A figure that must read left to right inside a right-to-left sentence. */
function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/**
 * The model against a guess as two labelled bars on one scale. Its own small
 * element, not the forecast's probability bar: the model in turquoise, the
 * guess in grey, each named and with its figure beside it, so the colour is
 * never the only sign.
 */
function Pair({
  lang,
  model,
  guess,
}: {
  lang: Locale;
  model: { share: number; figure: string };
  guess: { share: number; figure: string };
}) {
  const row = (
    key: 'model' | 'guess',
    label: 'modelAccuracy.verdict.model' | 'modelAccuracy.verdict.guess',
    bar: { share: number; figure: string },
  ) => (
    <>
      <dt className="text-xs text-muted">
        <Translated locale={lang} message={label} />
      </dt>
      <dd className="h-2.5 overflow-hidden rounded-pill bg-canvas" aria-hidden="true">
        <span
          className={key === 'model' ? 'block h-full bg-model' : 'block h-full bg-caption'}
          style={{ inlineSize: `${Math.max(0, Math.min(100, bar.share))}%` }}
          data-mark={key}
        />
      </dd>
      <dd className="text-xs font-semibold tabular-nums">{bar.figure}</dd>
    </>
  );
  return (
    <dl
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5"
      data-testid="accuracy-pair"
    >
      {row('model', 'modelAccuracy.verdict.model', model)}
      {row('guess', 'modelAccuracy.verdict.guess', guess)}
    </dl>
  );
}

function BigFigure({
  name,
  figure,
  caption,
  pair,
  exact,
}: {
  name: 'right' | 'error';
  figure: string;
  caption: ReactNode;
  pair: ReactNode;
  exact: ReactNode;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-tile bg-surface-raised p-4"
      data-testid="accuracy-big"
      data-figure={name}
    >
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-display-3 leading-none font-extrabold font-stretch-condensed tabular-nums">
          {figure}
        </span>
        <span className="text-sm font-semibold">{caption}</span>
      </p>
      {pair}
      <p className="text-xs text-muted">{exact}</p>
    </div>
  );
}

/** "5 Oct to 5 Nov 2026": the year once when both days share it, in the reader's calendar. */
function rangeDays(lang: Locale, from: string, to: string): { from: string; to: string } {
  const year = (iso: string) => formatDate(lang, iso, 'UTC', { year: 'numeric' });
  const short = { day: 'numeric', month: 'short' } as const;
  const full = { ...short, year: 'numeric' } as const;
  return {
    from: formatDate(lang, from, 'UTC', year(from) === year(to) ? short : full),
    to: formatDate(lang, to, 'UTC', full),
  };
}

export function VerdictCard({
  lang,
  report,
  weeks,
}: {
  lang: Locale;
  report: PublicModelAccuracyResponse;
  /** The record's weeks, for the sample line; null when the weekly figures did not arrive. */
  weeks: readonly WeekBar[] | null;
}) {
  const total = report.overall.total;
  const state = verdictState(total);
  const edge = edgeOverGuess(total.rps, total.uniform_rps);
  const name = attribute(lang, 'modelAccuracy.overall.title');
  const frame = {
    'aria-label': name.text,
    lang: name.lang,
    'data-testid': 'accuracy-overall',
    'data-coverage': total.coverage,
    'data-verdict': state,
  };
  const badge = (
    <CoverageBadge
      state={total.coverage}
      label={<Translated locale={lang} message={COVERAGE_KEY[total.coverage]} />}
      className="self-start"
    />
  );

  if (state === 'empty') {
    return (
      <section
        {...frame}
        className="flex flex-col gap-3 rounded-tile border border-default bg-surface p-4 sm:p-6"
      >
        {badge}
        <p className="max-w-measure text-base" data-testid="accuracy-not-supplied">
          <Translated locale={lang} message="modelAccuracy.notSupplied" />
        </p>
      </section>
    );
  }

  if (state === 'limited' || edge === null || total.accuracy === null) {
    return (
      <section
        {...frame}
        className="flex flex-col gap-3 rounded-tile border border-dashed border-strong bg-surface p-4 sm:p-6"
      >
        {badge}
        <p className="max-w-measure text-base font-semibold" data-testid="accuracy-limited">
          <MessageText
            message={plural(lang, 'modelAccuracy.limited', total.matches, {
              minimum: formatNumber(lang, report.minimum_matches),
            })}
          />
        </p>
        <p className="max-w-measure text-sm text-muted" data-testid="accuracy-limited-note">
          <Translated locale={lang} message="modelAccuracy.verdict.limitedNote" />
        </p>
      </section>
    );
  }

  const share = formatPercent(lang, total.accuracy * 100, 0);
  const guessShare = formatPercent(lang, report.reference.uniform_accuracy * 100, 0);
  const size = formatPercent(lang, Math.abs(edge.percent), 0);
  const worse = edge.percent < 0;
  const model = formatFixed(lang, edge.model, 3);
  const guess = formatFixed(lang, edge.guess, 3);
  const ratio = `${worse ? '−' : ''}${formatFixed(lang, Math.abs(edge.ratio), 2)}`;
  const widest = Math.max(edge.model, edge.guess);
  const first = weeks?.[0];
  const days =
    first !== undefined && report.last_updated_at !== null
      ? rangeDays(lang, `${first.periodStart}T00:00:00Z`, report.last_updated_at)
      : null;

  return (
    <section
      {...frame}
      className="flex flex-col gap-5 rounded-tile border border-t-3 border-default border-t-model bg-surface p-4 sm:gap-6 sm:p-6"
    >
      <p
        className="max-w-measure text-lg leading-snug font-semibold sm:text-xl"
        data-testid="accuracy-verdict-sentence"
      >
        <FilledMessage
          message={plural(lang, 'modelAccuracy.verdict.right', total.matches)}
          params={{ share: <b className="font-extrabold">{share}</b>, guess: guessShare }}
        />{' '}
        <FilledMessage
          message={message(
            lang,
            worse ? 'modelAccuracy.verdict.more' : 'modelAccuracy.verdict.less',
          )}
          params={{ edge: <b className="font-extrabold">{size}</b> }}
        />
      </p>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <BigFigure
          name="right"
          figure={share}
          caption={
            <Translated
              locale={lang}
              message="modelAccuracy.verdict.rightCaption"
              count={total.matches}
            />
          }
          pair={
            <Pair
              lang={lang}
              model={{
                share: total.accuracy * 100,
                figure: formatPercent(lang, total.accuracy * 100),
              }}
              guess={{ share: report.reference.uniform_accuracy * 100, figure: guessShare }}
            />
          }
          exact={
            <FilledMessage
              message={message(lang, 'modelAccuracy.verdict.rightExact')}
              params={{ share: formatPercent(lang, total.accuracy * 100), guess: guessShare }}
            />
          }
        />
        <BigFigure
          name="error"
          figure={size}
          caption={
            <Translated
              locale={lang}
              message={
                worse ? 'modelAccuracy.verdict.moreCaption' : 'modelAccuracy.verdict.lessCaption'
              }
            />
          }
          pair={
            <Pair
              lang={lang}
              model={{ share: (edge.model / widest) * 100, figure: model }}
              guess={{ share: (edge.guess / widest) * 100, figure: guess }}
            />
          }
          exact={
            <FilledMessage
              message={message(lang, 'modelAccuracy.verdict.rpsExact')}
              params={{ model, guess }}
            />
          }
        />
      </div>

      {/* D2: the arithmetic, from the figures as printed, with its sample. */}
      <p className="font-mono text-xs text-muted" data-testid="accuracy-arithmetic">
        <FilledMessage
          message={message(lang, 'modelAccuracy.verdict.arithmetic')}
          params={{
            equation: (
              <Ltr>
                ({guess} − {model}) ÷ {guess} = {ratio}
              </Ltr>
            ),
            percent: <Ltr>{formatEdge(lang, edge.percent, false)}</Ltr>,
          }}
        />
        {' · '}
        {days === null ? (
          <Translated locale={lang} message="modelAccuracy.available" count={total.matches} />
        ) : (
          <Translated
            locale={lang}
            message="modelAccuracy.verdict.range"
            count={total.matches}
            params={days}
          />
        )}
      </p>

      {/* D1's condition: the warning beside the sentence, never behind a click. */}
      <p
        className="max-w-measure border-s-3 border-strong ps-3 text-sm"
        data-testid="accuracy-caveat"
      >
        <Translated locale={lang} message="modelAccuracy.verdict.caveat" />
        {weeks !== null && weeks.length > 0 && (
          <>
            {' '}
            <Translated
              locale={lang}
              message="modelAccuracy.verdict.early"
              count={weeks.length}
              params={{ matches: formatNumber(lang, total.matches) }}
            />
          </>
        )}
      </p>
    </section>
  );
}
