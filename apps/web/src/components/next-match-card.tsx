import type { MatchViewing, TeamFixture } from '@fmip/contracts';
import Link from '@/components/ui/link';
import { formatDate } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { stageNames } from '@/lib/competition';
import type { CardForecast } from '@/lib/score-card-products';
import { formatKickoff } from '@/lib/scores';
import { territoryName } from '@/lib/territory';
import { optionsState } from '@/lib/viewing';
import { zoneWords } from '@/lib/reader-time-zone';
import { forecastBarWords } from '@/lib/words-server';
import { ForecastBar } from '@/components/forecast-bar';
import { MessageText } from '@/components/message-text';
import { Translated } from '@/components/translated';
import { Icon, LinkOut, inlineTargetClasses } from '@/components/ui';

/**
 * "Next match" (T-1388, D-206; the Club board's card since T-1499): the top
 * of a club page. The opponent, the date and kick-off in the reader's zone (named:
 * "Tehran time"), the statistical model's bar with its version and time --
 * or, with no forecast yet, a sentence saying so instead of empty lanes
 * (rule 3) -- and who broadcasts it in the reader's territory, each
 * broadcaster a link-out that names itself.
 *
 * Fed by answers the API already gives: the team page's `next_match`, the
 * model's pre-kick-off summary reduced to `CardForecast` (`cardForecast`, or
 * `{ state: 'unreachable' }` when the forecast service did not answer), and
 * the match's viewing listing (`null` when that did not answer). Only the
 * model's product is on the card; the community and the founder are not
 * summarised here (rule 6). A server component: it reads the catalogues.
 */
export function NextMatchCard({
  fixture,
  forecast,
  viewing,
  locale,
  timeZone,
}: {
  fixture: TeamFixture;
  forecast: CardForecast;
  /** The match's viewing listing in the reader's territory; `null`: the service did not answer. */
  viewing: MatchViewing | null;
  locale: string;
  timeZone: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const when = formatDate(l, fixture.kickoff_at, timeZone, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const zone = zoneWords(l, timeZone);
  const competition = fixture.competition.short_name ?? fixture.competition.name;
  // The stage and round in our words (D-193), never the feed's text (T-1386).
  const round = stageNames(l, fixture.stage?.name, fixture.round);
  // From the match's own status, not the clock: a render stays pure.
  const started = fixture.status !== 'scheduled';
  return (
    <article
      aria-label={t(l, 'nextMatch.title')}
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-default bg-surface"
      data-testid="next-match"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-default px-4 py-3 sm:px-5">
        <span className="text-xs font-extrabold text-accent uppercase ltr:tracking-widest">
          <Translated locale={l} message="nextMatch.title" />
        </span>
        <span className="text-sm text-muted">
          <bdi>{competition}</bdi>
          {round.map((label) => (
            <span key={label}>
              {' · '}
              <bdi>{label}</bdi>
            </span>
          ))}
          <span data-testid="next-match-when">
            {' · '}
            {when} · {zone}
          </span>
        </span>
      </div>

      <Link
        href={`/${locale}/match/${fixture.id}`}
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-5 sm:gap-5 sm:px-5 sm:py-6"
        data-testid="next-match-link"
      >
        <b className="min-w-0 text-end text-lg font-extrabold hyphens-auto [overflow-wrap:anywhere] sm:text-2xl">
          <bdi>{fixture.home.name}</bdi>
        </b>
        <b
          className="text-2xl leading-none font-black font-stretch-condensed tabular-nums sm:text-3xl"
          dir="ltr"
        >
          <time dateTime={fixture.kickoff_at}>
            {formatKickoff(l, fixture.kickoff_at, timeZone)}
          </time>
        </b>
        <b className="min-w-0 text-start text-lg font-extrabold hyphens-auto [overflow-wrap:anywhere] sm:text-2xl">
          <bdi>{fixture.away.name}</bdi>
        </b>
      </Link>

      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <ForecastBar
          forecast={forecast}
          home={fixture.home.name}
          away={fixture.away.name}
          started={started}
          locale={l}
          timeZone={timeZone}
          zone={zone}
          words={forecastBarWords(l)}
          size="compact"
        />

        <Broadcasters viewing={viewing} fixtureId={fixture.id} locale={l} />
      </div>
    </article>
  );
}

/** "Watch: IRIB TV3 ↗ · Telewebion ↗", or why there is no such line. */
function Broadcasters({
  viewing,
  fixtureId,
  locale,
}: {
  viewing: MatchViewing | null;
  fixtureId: string;
  locale: Locale;
}) {
  const state = viewing === null ? 'unreachable' : optionsState(viewing);
  const territory =
    viewing !== null && viewing.territory.state === 'chosen'
      ? territoryName(locale, viewing.territory.territory)
      : '';
  const sentence = (key: 'scores.card.noSchedule' | 'scores.card.nothingListed') => {
    const m = message(locale, key);
    return <MessageText message={{ ...m, text: interpolate(m.text, { territory }) }} />;
  };
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-default pt-2 text-sm"
      data-testid="next-match-watch"
      data-state={state}
    >
      <Icon name="screen" className="text-muted" />
      <span className="font-semibold text-muted">
        <Translated locale={locale} message="scores.card.watch" />
      </span>
      {state === 'listed' && viewing?.options.data ? (
        viewing.options.data.map((option, index) => (
          <span key={option.id} className="inline-flex items-center gap-1.5">
            {index > 0 && <span aria-hidden="true">·</span>}
            <LinkOut href={option.url} host={option.broadcaster.name} />
          </span>
        ))
      ) : state === 'ask' ? (
        <Link
          href={`/${locale}/match/${fixtureId}#watch`}
          className={inlineTargetClasses('underline')}
        >
          <Translated locale={locale} message="scores.card.chooseTerritory" />
        </Link>
      ) : state === 'not_supplied' ? (
        sentence('scores.card.noSchedule')
      ) : state === 'nothing_listed' ? (
        sentence('scores.card.nothingListed')
      ) : (
        <Translated locale={locale} message="scores.card.unreachable" />
      )}
    </p>
  );
}
