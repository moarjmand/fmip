import type { ScoreCard as ScoreCardData } from '@fmip/contracts';
import { ScoreCard } from '@/components/score-card';
import { Translated } from '@/components/translated';
import { ButtonLink } from '@/components/ui';
import type { CardForecast } from '@/lib/score-card-products';
import type { ScoresWords } from '@/lib/words-server';

/**
 * The Live view when nothing is in play (T-1779, D-386; board P6-5): the
 * sentence, then today's next kick-off as the list's own 72px row, Pick
 * included, and one way back to the whole day. "Next" is the earliest
 * kick-off still to come (`nextKickoff`), never the rail's pick of the day,
 * and the row says the time of the match, not how long until it: nothing
 * counts down. With nothing left to start today the page says so; another
 * day than today keeps its own sentence. The founder's analysis and the
 * two links under the list are not drawn here: neither is about live.
 *
 * Server-drawn and handed to the live list, which shows it while the
 * stream's answer is empty; no script of its own.
 */
export function LiveNext({
  locale,
  timeZone,
  today,
  next,
  country,
  count,
  showHref,
  pickHref,
  forecast,
  picked,
  selected,
  now,
  words,
}: {
  locale: string;
  timeZone: string;
  /** The day shown is today in the viewer's zone. */
  today: boolean;
  /** Today's earliest kick-off still to come, if any. */
  next: ScoreCardData | null;
  /** The next match's competition's country, when its group names one. */
  country: string | null;
  /** How many matches the day holds (under the page's filters). */
  count: number;
  /** The same day, every match: the All view. */
  showHref: string;
  /** The next row's Pick: this page with its preview open. */
  pickHref: string | undefined;
  forecast: CardForecast | undefined;
  picked: boolean;
  selected: boolean;
  now: number;
  words: ScoresWords;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="live-none">
      <p className="text-muted" data-testid="scores-empty" data-view="live">
        <Translated locale={locale} message={today ? 'scores.liveNow' : 'scores.liveEmpty'} />
      </p>
      {today && next !== null && (
        <section
          className="flex flex-col overflow-clip rounded-xl border border-default bg-surface"
          data-testid="live-next"
        >
          <div className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2.5 border-b border-default px-4 py-1 text-sm">
            <h2 className="font-extrabold">
              <Translated locale={locale} message="scores.liveNext" />
            </h2>
            <span className="min-w-0 text-xs font-medium text-muted">
              <bdi>{next.competition.name}</bdi>
              {country !== null && (
                <>
                  {' · '}
                  <bdi>{country}</bdi>
                </>
              )}
            </span>
          </div>
          <ul className="@container flex flex-col divide-y divide-default">
            <ScoreCard
              card={next}
              timeZone={timeZone}
              locale={locale}
              now={now}
              forecast={forecast}
              picked={picked}
              selected={selected}
              pickHref={pickHref}
              words={words}
            />
          </ul>
        </section>
      )}
      {today && next === null && (
        <p data-testid="live-none-left">
          <Translated locale={locale} message="scores.liveNoneLeft" />
        </p>
      )}
      {count > 0 && (
        <ButtonLink
          href={showHref}
          size="md"
          className="self-start font-semibold"
          data-testid="live-show-day"
        >
          <Translated
            locale={locale}
            message={today ? 'scores.liveShowToday' : 'scores.liveShowDay'}
            count={count}
          />
        </ButtonLink>
      )}
    </div>
  );
}
