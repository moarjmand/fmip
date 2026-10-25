import { DEFAULT_LOCALE } from '@/i18n/locales';
import { formatNumber, formatVersionStamp } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import type { CardForecast } from '@/lib/score-card-products';
import { FORECAST_REASON_KEY, fill, filled, formatPercent } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { ModelVersion } from '@/components/model-version';
import { Receipt } from '@/components/receipt';
import { cx } from '@/components/ui/cx';

/**
 * The statistical model's forecast as a bar (the Design System's
 * `ForecastBar`, T-1508, D-263): the three outcomes with their percentages
 * written above one bar -- home in the model's colour, the draw neutral, away
 * the model's colour lightened, apart in lightness so the bar reads without
 * hue -- and **always** the model's receipt under it (blueprint 6.2: the
 * version and time are always on screen). One product: this takes the
 * model's answer and nothing else, so it cannot be handed the community's
 * spread or the founder's call (rule 6, `three-products.spec.ts`).
 *
 * After full time a page may pass `outcome`, what happened: that segment
 * turns saffron and its label says "happened". The forecast itself is the
 * stored version's, never adjusted (rule 5). `compact` drops the labels and
 * prints the three numbers under a thin bar, for a card or a lane.
 *
 * No forecast is a sentence, never an empty bar (rule 3): not computed yet,
 * none before kick-off, a version with no probabilities and why, or the
 * service not answering. The segments follow the reading direction, so in
 * Persian the home team's share sits on the right with Persian digits.
 *
 * The input is the scores card's `CardForecast`, which both a full forecast
 * version and a pre-kick-off summary reduce to (`cardForecast`). The words
 * are resolved on the server (`forecastBarWords`), so the bar is safe in a
 * client bundle as well as on a server page.
 */

export const FORECAST_BAR_KEYS = [
  'forecastBar.label',
  'forecastBar.computed',
  'forecastBar.version',
  'forecastBar.happened',
  'forecastBar.none',
  'forecastBar.noneBefore',
  'forecastBar.unavailable',
  'forecastBar.unreachable',
  'forecastBar.noForecast',
  'forecastBar.notLoaded',
  'forecast.draw',
  'scores.card.model.couldNotAnswer',
  ...Object.values(FORECAST_REASON_KEY),
] as const;

export type ForecastBarWords = Record<(typeof FORECAST_BAR_KEYS)[number], Message>;

export type Outcome = 'home' | 'draw' | 'away';

/** Each segment's fill: home the model colour, draw neutral, away lighter; what happened, saffron. */
const FILL: Record<Outcome, string> = {
  home: 'bg-model',
  draw: 'bg-prob-draw',
  away: 'bg-prob-away',
};

type Available = Extract<CardForecast, { state: 'available' }>;

/** The model's receipt for a forecast: its model, its version, when it was computed. */
export function ForecastReceipt({
  forecast,
  locale,
  timeZone,
  zone,
  words,
  className,
}: {
  forecast: Available;
  locale: string;
  timeZone: string;
  zone?: string;
  words: ForecastBarWords;
  className?: string;
}) {
  return (
    <Receipt
      className={className}
      testId="forecast-bar-meta"
      items={[
        <span key="model" dir="ltr">
          <ModelVersion version={forecast.model_version} />
        </span>,
        <MessageText
          key="version"
          message={filled(words['forecastBar.version'], {
            version: formatNumber(locale, forecast.version),
          })}
        />,
        <FilledMessage
          key="computed"
          message={words['forecastBar.computed']}
          params={{
            time: (
              <time dateTime={forecast.computed_at}>
                {formatVersionStamp(locale, forecast.computed_at, timeZone)}
                {zone !== undefined ? ` ${zone}` : timeZone === 'UTC' ? ' UTC' : ''}
              </time>
            ),
          }}
        />,
      ]}
    />
  );
}

export function ForecastBar({
  forecast,
  home,
  away,
  started = false,
  outcome,
  locale,
  timeZone,
  zone,
  words,
  compact = false,
  className,
}: {
  forecast: CardForecast;
  home: string;
  away: string;
  /** The match has kicked off, so "not yet" would be the wrong sentence. */
  started?: boolean;
  /** After full time: the outcome that happened, which the bar marks in saffron. */
  outcome?: Outcome | null;
  locale: string;
  timeZone: string;
  /**
   * The zone in words (`zoneWords`), said after the time (T-1395): the page's
   * own zone, so the stamp reads on the same clock as the kick-off. Without it
   * only UTC is named.
   */
  zone?: string;
  words: ForecastBarWords;
  /** A thin bar with the three numbers under it, for a card or a lane. */
  compact?: boolean;
  className?: string;
}) {
  if (forecast.state !== 'available') {
    const sentence: Message =
      forecast.state === 'unavailable'
        ? filled(words['forecastBar.unavailable'], {
            version: formatNumber(locale, forecast.version),
            reason:
              words[
                forecast.reason === null
                  ? 'scores.card.model.couldNotAnswer'
                  : FORECAST_REASON_KEY[forecast.reason]
              ].text,
          })
        : forecast.state === 'unreachable'
          ? words['forecastBar.unreachable']
          : words[started ? 'forecastBar.noneBefore' : 'forecastBar.none'];
    return (
      <p
        className={cx(
          'rounded-control border border-dashed border-caption px-3 py-2 text-sm text-muted',
          className,
        )}
        data-testid="forecast-bar"
        data-state={forecast.state}
      >
        <MessageText message={sentence} />
      </p>
    );
  }

  const outcomes = [
    { key: 'home', name: home, value: forecast.home },
    { key: 'draw', name: words['forecast.draw'], value: forecast.draw },
    { key: 'away', name: away, value: forecast.away },
  ] as const;
  const pct = (value: number) => formatPercent(locale, value);
  const happened = outcome ?? null;
  return (
    <div
      className={cx('flex flex-col gap-2', className)}
      data-testid="forecast-bar"
      data-state="available"
      data-outcome-happened={happened ?? undefined}
      data-size={compact ? 'compact' : 'default'}
    >
      {!compact && (
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm font-bold tabular-nums">
          {outcomes.map(({ key, name, value }) => (
            <span
              key={key}
              data-outcome={key}
              className={
                happened === key ? 'text-accent' : key === 'draw' ? 'text-muted' : 'text-fg'
              }
            >
              {typeof name === 'string' ? <bdi>{name}</bdi> : <MessageText message={name} />}{' '}
              <span dir="ltr">{pct(value)}</span>
              {happened === key && (
                <>
                  {' · '}
                  <MessageText message={words['forecastBar.happened']} />
                </>
              )}
            </span>
          ))}
        </div>
      )}
      <ForecastStrip
        forecast={forecast}
        home={home}
        away={away}
        outcome={happened}
        locale={locale}
        words={words}
        compact={compact}
      />
      <ForecastReceipt
        forecast={forecast}
        locale={locale}
        timeZone={timeZone}
        zone={zone}
        words={words}
      />
    </div>
  );
}

/**
 * The bar itself, and in `compact` the three numbers under it, without the
 * labels or the receipt: what a match row draws in its end column, with the
 * receipt on its own line under the row (`match-row.tsx`). Anywhere else, use
 * `ForecastBar`, which always carries the receipt.
 */
export function ForecastStrip({
  forecast,
  home,
  away,
  outcome = null,
  locale,
  words,
  compact = false,
  className,
}: {
  forecast: Available;
  home: string;
  away: string;
  outcome?: Outcome | null;
  locale: string;
  words: ForecastBarWords;
  compact?: boolean;
  className?: string;
}) {
  const label = words['forecastBar.label'];
  const pct = (value: number) => formatPercent(locale, value);
  const shares = [
    { key: 'home', value: forecast.home },
    { key: 'draw', value: forecast.draw },
    { key: 'away', value: forecast.away },
  ] as const;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <div
        role="img"
        aria-label={fill(label.text, {
          home,
          homePct: pct(forecast.home),
          drawPct: pct(forecast.draw),
          away,
          awayPct: pct(forecast.away),
        })}
        lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
        className={cx('flex gap-0.5 overflow-hidden rounded-pill', compact ? 'h-2' : 'h-3')}
      >
        {shares.map(({ key, value }) => (
          <span
            key={key}
            data-segment={key}
            className={outcome === key ? 'bg-brand' : FILL[key]}
            // The share of the bar is the probability itself; a floor keeps a
            // 2% outcome visible as a sliver rather than a gap.
            style={{ flexGrow: Math.max(value, 1.5), flexBasis: 0 }}
          />
        ))}
      </div>
      {compact && (
        // The figures are in the bar's own label, so a screen reader hears them once.
        <div
          aria-hidden="true"
          className="flex justify-between gap-2 font-mono text-xs text-model tabular-nums [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
        >
          {shares.map(({ key, value }) => (
            <span
              key={key}
              data-outcome={key}
              className={outcome === key ? 'text-accent' : undefined}
            >
              {pct(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
