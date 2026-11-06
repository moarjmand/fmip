import type { ScoreCard } from '@fmip/contracts';
import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import type { Message } from '@/i18n/messages';
import { wholePercentages } from '@/lib/triple';
import { fill, formatPercent } from '@/lib/words';
import { MessageText } from '@/components/message-text';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

/**
 * The statistical model's three probabilities, drawn one way everywhere
 * (T-1748, D-368; T-1749, D-369; boards P3-2 and P3-3). Every place that
 * shows them -- a list row, a card, the match page's headline and its list of
 * versions -- renders this component, so the language cannot drift again.
 *
 * - **Order**: home, draw, away, always. The markup is in that order and the
 *   layout is flex, so a right-to-left page puts home at the inline start
 *   (the right) with nothing physical written.
 * - **Steps follow rank, not place**: the likeliest outcome is the model's
 *   full turquoise, the second 75% of it, the third 50% (`rankSteps`). Away
 *   is never the brightest thing because it is away.
 * - **Each label sits with its own segment**: a label cell grows by the same
 *   share as its segment. The number is always written; a team's name is
 *   shown whole or not at all (`.forecast-name` in `globals.css`), never cut
 *   and never broken. The third step is under 3:1 on a Day card, which is
 *   allowed only because the value is written beside it: so no size draws a
 *   segment without its number.
 * - **What happened** (`outcome`, after full time): a 2px ink outline around
 *   the segment, outside it with a 1px gap, and a tick before its number (an
 *   underline where the cell is too narrow for the tick: `MARKS`).
 *   Never a colour: saffron is the reader's pick and the live minute, and
 *   turquoise the model alone (rule 6). The word "happened" is written only
 *   at `headline` size, the match page's; the accessible name says it at
 *   every size.
 *
 * Sizes: `row` (8px bar, whole percentages totalling 100), `card` (12px, one
 * decimal and the names) and `headline` (18px). `labels` overrides what a
 * size writes: the match page's version list is a `row` with `named` labels.
 *
 * One product: this takes the model's answer and nothing else, so it cannot
 * be handed the community's spread or the founder's call (rule 6,
 * `three-products.spec.ts`). The forecast is the stored version's, never
 * adjusted (rule 5).
 *
 * It draws three shares and nothing else. Where a page holds a
 * `CardForecast` -- which may be no forecast at all -- it uses
 * `ForecastBarWithReceipt` (`forecast-receipt.tsx`), which is this bar with
 * the model's receipt under it, or the sentence that says why there is no
 * forecast (rule 3). They are two modules on purpose: the scores row is
 * drawn by the page's live view, and this one brings nothing of the receipt
 * into that script. The words are resolved on the server and no hook is
 * used, so the bar is safe in a client bundle as well as on a server page.
 */

/** The words the bar itself writes: its accessible name, "happened" and the draw. */
export type ForecastBarLabels = Record<
  'forecastBar.label' | 'forecastBar.happened' | 'forecast.draw',
  Message
>;

export type Outcome = 'home' | 'draw' | 'away';
export type ForecastBarSize = 'row' | 'card' | 'headline';

/** The three shares in percent, all the bar draws. */
export type ForecastShares = Record<Outcome, number>;

/** The fixed order of the bar and of everything that reads it (D-368). */
const ORDER = ['home', 'draw', 'away'] as const;

/**
 * Equal shares: home, then away, then the draw -- the order in which the
 * product names the model's pick (`modelPick` in `lib/moments-rail.ts`), so
 * the darkest segment and "the model's pick" are never two outcomes.
 */
const TIE: Record<Outcome, number> = { home: 0, away: 1, draw: 2 };

const STEP_FILL = { 1: 'bg-model', 2: 'bg-model/75', 3: 'bg-model/50' } as const;

/**
 * Each outcome's step by the rank of its share (D-368): 1 the likeliest, 3
 * the least likely. Ties are settled by `TIE`, so the answer never depends on
 * the order the shares arrive in.
 */
export function rankSteps(shares: Record<Outcome, number>): Record<Outcome, 1 | 2 | 3> {
  const ranked = [...ORDER].sort((a, b) => shares[b] - shares[a] || TIE[a] - TIE[b]);
  const steps: Record<Outcome, 1 | 2 | 3> = { home: 3, draw: 3, away: 3 };
  ranked.forEach((key, index) => {
    steps[key] = index === 0 ? 1 : index === 1 ? 2 : 3;
  });
  return steps;
}

/**
 * What happened in the ninety minutes, once a match is over: the result the
 * statistical model forecasts (extra time and a shoot-out are not in it), so
 * the one a bar marks on a list's card (T-1749, D-369). `null` before full
 * time, with no score, and when the recorded goals disagree with the result
 * (T-1717): no outcome is then drawn as the one that happened.
 *
 * It lives here, not in `lib/scores.ts`, because that module is in the
 * script of every page with a live view, and only a bar asks this.
 */
export function ninetyOutcome(
  card: Pick<ScoreCard, 'status' | 'scores' | 'score_dispute'>,
): Outcome | null {
  if (card.status !== 'finished' || card.score_dispute != null) return null;
  const line = card.scores.full_time ?? card.scores.current;
  if (line === null) return null;
  return line.home > line.away ? 'home' : line.home < line.away ? 'away' : 'draw';
}

/**
 * A name's width in em, estimated letter by letter from the faces the site
 * sets names in (measured in a browser, T-1748): narrow, wide and capital
 * Latin letters, a flat figure for the Persian and Arabic ones, nothing for a
 * joiner. Only the stylesheet's decision to give up an empty line reads it;
 * whether a name is drawn is decided by the real text in the browser, so a
 * wrong estimate costs a blank line or a name left out, never a cut one.
 */
export function nameEm(name: string): number {
  let em = 0;
  for (const letter of name) {
    em += /\p{Cf}/u.test(letter)
      ? 0
      : /\p{Script=Arabic}/u.test(letter)
        ? 0.48
        : /[iljtfrI .,'’-]/.test(letter)
          ? 0.3
          : /[mwMW]/.test(letter)
            ? 0.85
            : /\p{Lu}/u.test(letter)
              ? 0.68
              : 0.56;
  }
  return Math.round(em * 10) / 10;
}

/**
 * What a label cell writes, given the room it has (board P3-2): the number
 * and the name on one line when both fit, the name under the number when the
 * name alone fits the cell, else the number alone. The stylesheet applies
 * this rule to the measured text; this is the same rule in numbers, for the
 * spec and for anyone sizing a place for the bar.
 */
export function labelLines({
  cell,
  number,
  name,
  gap = 6,
}: {
  /** The cell's width: the bar's width, less its gaps, times the share. */
  cell: number;
  number: number;
  /** The name's width, with " · happened" where it is written. */
  name: number;
  gap?: number;
}): 'one' | 'two' | 'number' {
  if (number + gap + name <= cell) return 'one';
  return name <= cell ? 'two' : 'number';
}

interface SizeClasses {
  /** The space between the labels and the bar. */
  gap: string;
  bar: string;
  labels: string;
  number: string;
  name: string;
}

const SIZES: Record<ForecastBarSize, SizeClasses> = {
  row: {
    gap: 'gap-1',
    bar: 'h-2',
    labels: 'font-mono text-xs leading-4 [:root:is(:lang(fa),:lang(ar))_&]:font-sans',
    number: '',
    // A name is set in the interface face; the mono one is for the figures.
    name: 'font-sans',
  },
  card: {
    gap: 'gap-1.5',
    bar: 'h-3',
    labels: 'text-[0.8125rem] leading-[1.125rem]',
    number: 'font-bold',
    name: '',
  },
  headline: {
    // A phone's first screen has no line to spare (T-1744): two 16px lines
    // at most, and the names a size under the numbers.
    gap: 'gap-1 md:gap-2',
    bar: 'h-4.5',
    labels: 'text-sm leading-4 md:text-base md:leading-6',
    number: 'font-bold max-md:font-stretch-condensed',
    name: 'max-md:text-xs md:text-[0.9375rem]',
  },
};

/**
 * The mark on the number that happened (D-369): a tick before it where its
 * cell has room for both, else an underline -- so the mark never makes a
 * label wider than its segment. The cell is the query container; the widths
 * are the number and the tick as each size sets them.
 */
const MARKS = {
  narrow: {
    tick: 'hidden @min-[2.75rem]:block',
    number: 'underline decoration-2 underline-offset-2 @min-[2.75rem]:no-underline',
  },
  wide: {
    tick: 'hidden @min-[3.5rem]:block',
    number: 'underline decoration-2 underline-offset-2 @min-[3.5rem]:no-underline',
  },
  headline: {
    tick: 'hidden max-md:@min-[3.5rem]:block md:@min-[4.25rem]:block',
    number:
      'underline decoration-2 underline-offset-2 max-md:@min-[3.5rem]:no-underline md:@min-[4.25rem]:no-underline',
  },
} as const;

/** The ends of the bar are round, the joins between segments nearly square. */
const SEGMENT_SHAPE: Record<Outcome, string> = {
  home: 'rounded-s-pill rounded-e-xs',
  draw: 'rounded-xs',
  away: 'rounded-s-xs rounded-e-pill',
};

export function ForecastBar({
  forecast: shares,
  home,
  away,
  size = 'card',
  labels,
  outcome,
  locale,
  words,
  className,
  testId = 'forecast-bar',
  children,
}: {
  /** The three shares, in percent. */
  forecast: ForecastShares;
  home: string;
  away: string;
  /** `row` in a list, `card` in a card (the default), `headline` on the match page. */
  size?: ForecastBarSize;
  /**
   * `numbers`: whole percentages totalling 100 and nothing else (a `row`'s
   * default). `named`: one decimal, and each side's name where it fits whole.
   */
  labels?: 'numbers' | 'named';
  /** After full time: the outcome that happened, outlined and ticked. */
  outcome?: Outcome | null;
  locale: string;
  words: ForecastBarLabels;
  className?: string;
  testId?: string;
  /** What stands under the bar inside its frame: the model's receipt, where the bar carries it. */
  children?: ReactNode;
}) {
  const named = (labels ?? (size === 'row' ? 'numbers' : 'named')) === 'named';
  const happened = outcome ?? null;
  const steps = rankSteps(shares);
  const whole = wholePercentages(shares);
  const classes = SIZES[size];
  const mark = MARKS[size === 'headline' ? 'headline' : named ? 'wide' : 'narrow'];
  const pct = (value: number) => formatPercent(locale, value);
  const happenedWord = words['forecastBar.happened'];
  const label = words['forecastBar.label'];
  // The accessible name says every figure once, and what happened in words:
  // the tick and the outline are not its only carriers.
  const said = (key: Outcome) =>
    happened === key ? `${pct(shares[key])} (${happenedWord.text})` : pct(shares[key]);
  // The share is the probability itself; a floor keeps 2% a sliver, not a gap.
  const grow = (key: Outcome) => Math.max(shares[key], 1.5);
  return (
    <div
      className={cx('flex flex-col', classes.gap, className)}
      data-testid={testId}
      data-state="available"
      data-size={size}
      data-outcome-happened={happened ?? undefined}
    >
      {/* The figures are in the bar's own label, so a screen reader hears them once. */}
      <div
        aria-hidden="true"
        className={cx('flex items-start gap-0.5 text-fg tabular-nums', classes.labels)}
      >
        {ORDER.map((key) => {
          const number = named ? pct(shares[key]) : formatPercent(locale, whole[key], 0);
          const name = key === 'draw' ? words['forecast.draw'] : key === 'home' ? home : away;
          const mine = happened === key;
          return (
            <span
              key={key}
              data-outcome={key}
              data-happened={mine ? '' : undefined}
              className={cx(
                '@container flex flex-wrap content-start items-baseline gap-x-1.5',
                key === 'away' && 'justify-end',
              )}
              // The cell is as wide as its segment, and never narrower than
              // its own number: a 6% label takes a little from its neighbour
              // rather than running into it.
              style={{
                flexGrow: grow(key),
                flexBasis: 0,
                minWidth: `${[...number].length + 0.5}ch`,
              }}
            >
              <span
                // The tick is centred on the line and takes no part in the
                // baseline, so the number sits on the same line as the name.
                className={cx(
                  'flex flex-none items-baseline gap-0.5 whitespace-nowrap',
                  classes.number,
                )}
              >
                {mine && (
                  <Icon
                    name="check"
                    strokeWidth={2.6}
                    className={cx('size-[1em] self-center', mark.tick)}
                  />
                )}
                <span dir="ltr" className={mine ? mark.number : undefined}>
                  {number}
                </span>
              </span>
              {named && (
                <span
                  data-name=""
                  className={cx('forecast-name text-muted', classes.name)}
                  style={
                    {
                      '--forecast-name': `${nameEm(typeof name === 'string' ? name : name.text)}em`,
                    } as CSSProperties
                  }
                >
                  {typeof name === 'string' ? (
                    <bdi>{name}</bdi>
                  ) : (
                    <span>
                      <MessageText message={name} />
                    </span>
                  )}
                  {mine && size === 'headline' && (
                    <span className="ms-1.5 text-fg" data-happened-word="">
                      {'· '}
                      <MessageText message={happenedWord} />
                    </span>
                  )}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div
        role="img"
        aria-label={fill(label.text, {
          home,
          homePct: said('home'),
          drawPct: said('draw'),
          away,
          awayPct: said('away'),
        })}
        lang={label.status === 'untranslated' ? DEFAULT_LOCALE : undefined}
        className={cx('flex gap-0.5', classes.bar)}
      >
        {ORDER.map((key) => (
          <span
            key={key}
            data-segment={key}
            data-step={steps[key]}
            data-happened={happened === key ? '' : undefined}
            className={cx(
              STEP_FILL[steps[key]],
              SEGMENT_SHAPE[key],
              // The container does not clip, so the outline shows outside the segment.
              happened === key && 'outline-2 outline-offset-1 outline-fg',
            )}
            style={{ flexGrow: grow(key), flexBasis: 0 }}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
