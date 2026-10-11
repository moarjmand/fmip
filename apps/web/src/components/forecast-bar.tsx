import { DEFAULT_LOCALE } from '@/i18n/locales';
import { formatNumber, formatVersionStamp } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import type { CardForecast } from '@/lib/score-card-products';
import { FORECAST_REASON_KEY, fill, filled, formatPercent } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { cx } from '@/components/ui/cx';

/**
 * The statistical model's forecast as a bar (T-1388, D-206): the model's
 * lane colour only, in three lightness steps -- home the full colour, the
 * draw lighter, away lightest -- the three outcomes labelled with their
 * percentages below, and **always** the model id and the computation time
 * under it (blueprint 6.2: the version and time are always on screen). One
 * product: this takes the model's answer and nothing else, so it cannot be
 * handed the community's spread or the founder's call (rule 6,
 * `three-products.spec.ts`). The members' spread has its own bar in its own
 * file and its own colour.
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
  'forecastBar.none',
  'forecastBar.noneBefore',
  'forecastBar.unavailable',
  'forecastBar.unreachable',
  'forecast.draw',
  'scores.card.model.couldNotAnswer',
  ...Object.values(FORECAST_REASON_KEY),
] as const;

export type ForecastBarWords = Record<(typeof FORECAST_BAR_KEYS)[number], Message>;

/** The three steps of the model's colour, home strongest (the design's one hue, three lightnesses). */
const STEPS = { home: 'bg-model', draw: 'bg-model/55', away: 'bg-model/25' } as const;

export function ForecastBar({
  forecast,
  home,
  away,
  started = false,
  locale,
  timeZone,
  zone,
  words,
  size = 'default',
  className,
}: {
  forecast: CardForecast;
  home: string;
  away: string;
  /** The match has kicked off, so "not yet" would be the wrong sentence. */
  started?: boolean;
  locale: string;
  timeZone: string;
  /**
   * The zone in words (`zoneWords`), said after the time (T-1395): the page's
   * own zone, so the stamp reads on the same clock as the kick-off. Without it
   * only UTC is named.
   */
  zone?: string;
  words: ForecastBarWords;
  /**
   * `compact` for a card or a lane (an 8px bar); `default` for a section's
   * own forecast; `row` for a line in a list of matches (T-1385): a short
   * bar, the three percentages home · draw · away, and the model id and time
   * on the same line, wrapping on a phone.
   */
  size?: 'default' | 'compact' | 'row';
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
          'rounded-control border border-dashed border-model text-muted',
          size === 'row' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm',
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
  const label = words['forecastBar.label'];
  const pct = (value: number) => formatPercent(locale, value);
  const ariaLabel = fill(label.text, {
    home,
    homePct: pct(forecast.home),
    drawPct: pct(forecast.draw),
    away,
    awayPct: pct(forecast.away),
  });
  const meta = (
    <>
      <span dir="ltr" className="text-model">
        {forecast.model_version}
      </span>
      <FilledMessage
        message={words['forecastBar.computed']}
        params={{
          time: (
            <time dateTime={forecast.computed_at}>
              {formatVersionStamp(locale, forecast.computed_at, timeZone)}
              {zone !== undefined ? ` ${zone}` : timeZone === 'UTC' ? ' UTC' : ''}
            </time>
          ),
        }}
      />
    </>
  );
  if (size === 'row') {
    // One line in a list of matches: the outcomes' names are the row's own
    // teams, so the figures stand alone, home first in the reading direction.
    return (
      <div
        className={cx('flex flex-wrap items-center gap-x-2.5 gap-y-1', className)}
        data-testid="forecast-bar"
        data-state="available"
        data-size="row"
      >
        <div
          role="img"
          aria-label={ariaLabel}
          lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
          className="flex h-2 w-24 shrink-0 gap-0.5"
        >
          {outcomes.map(({ key, value }) => (
            <span
              key={key}
              data-outcome={key}
              className={cx('rounded-xs', STEPS[key])}
              style={{ flexGrow: Math.max(value, 1.5), flexBasis: 0 }}
            />
          ))}
        </div>
        <span aria-hidden="true" className="text-xs font-semibold text-muted tabular-nums">
          {outcomes.map(({ key, value }, i) => (
            <span key={key}>
              {i > 0 && ' · '}
              <bdi>{pct(value)}</bdi>
            </span>
          ))}
        </span>
        <span
          className="inline-flex flex-wrap items-center gap-x-2 font-mono text-xs text-caption [:root:is(:lang(fa),:lang(ar))_&]:font-sans"
          data-testid="forecast-bar-meta"
        >
          {meta}
        </span>
      </div>
    );
  }
  return (
    <div
      className={cx('flex flex-col', className)}
      data-testid="forecast-bar"
      data-state="available"
    >
      <div
        role="img"
        aria-label={ariaLabel}
        lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
        className={cx('flex gap-0.75', size === 'compact' ? 'h-2' : 'h-3')}
      >
        {outcomes.map(({ key, value }) => (
          <span
            key={key}
            data-outcome={key}
            className={cx('rounded-sm', STEPS[key])}
            // The share of the bar is the probability itself; a floor keeps a
            // 2% outcome visible as a sliver rather than a gap.
            style={{ flexGrow: Math.max(value, 1.5), flexBasis: 0 }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-muted">
        {outcomes.map(({ key, name, value }) => (
          <span key={key} className="inline-flex items-center gap-1.5" data-outcome={key}>
            <span aria-hidden="true" className={cx('size-2.5 rounded-xs', STEPS[key])} />
            {typeof name === 'string' ? <bdi>{name}</bdi> : <MessageText message={name} />}
            <b className="font-extrabold text-fg tabular-nums" dir="ltr">
              {pct(value)}
            </b>
          </span>
        ))}
      </div>
      <p
        className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-caption"
        data-testid="forecast-bar-meta"
      >
        {meta}
      </p>
    </div>
  );
}
