import type { CoverageState, ScoreCard as ScoreCardData, ScoreCardIncident } from '@fmip/contracts';
import Link from 'next/link';
import { formatNumber } from '@/i18n/format';
import { isBehind } from '@/lib/live';
import { formatKickoff, scoreLabel, statusLabel } from '@/lib/scores';
import type { CardCommunity, CardForecast, CardViewing } from '@/lib/score-card-products';
import { fill, filled, formatMinute, pickPlural } from '@/lib/words';
import type { ScoresWords } from '@/lib/words-server';
import { EntityImage } from '@/components/entity-image';
import { FilledMessage } from '@/components/filled-message';
import { MessageText } from '@/components/message-text';
import { LtrNumeric, ltrIsolate } from '@/components/score';
import { CardCommunityTotals } from '@/components/score-card-community';
import { CardForecastSummary } from '@/components/score-card-forecast';

const INCIDENT_KEY = {
  goal: 'matchCentre.incident.goal',
  own_goal: 'matchCentre.incident.ownGoal',
  penalty_goal: 'matchCentre.incident.penaltyGoal',
  penalty_missed: 'matchCentre.incident.penaltyMissed',
  red_card: 'matchCentre.incident.redCard',
  second_yellow_card: 'matchCentre.incident.secondYellow',
  var: 'matchCentre.incident.var',
} as const satisfies Record<ScoreCardIncident['kind'], string>;

/** A coverage state in the glossary's words (T-1303). */
export const COVERAGE_KEY = {
  available: 'status.coverage.available',
  limited: 'status.coverage.limited',
  not_supplied: 'status.coverage.notSupplied',
  delayed: 'status.coverage.delayed',
} as const satisfies Record<CoverageState, string>;

/**
 * One match on the scores list (blueprint 4.1), phone first (T-605).
 *
 * The row is one line and one link: status or clock, home, score, away, the
 * names cut short with an ellipsis rather than wrapping, each in a `<bdi>` so
 * a name in another script cannot reorder the line. It is at least 44px tall,
 * a thumb's target. Everything else the card carries -- the stage and round,
 * kick-off and venue, goals and cards, the model's forecast summary, the
 * community's totals and where to watch (T-940), each with its reason when it
 * has no figure (rule 3) -- is one press away behind the row's own
 * disclosure, so a Saturday with every league playing is a list a phone can
 * scroll. Two things never hide: a leg or an aggregate (it changes what the
 * score means) and a feed that is behind (rule 4), which is said on the row.
 * The block's "Updated" line is the list's (`LiveScores`), per competition.
 *
 * Every word is the reader's (T-1303): this renders inside a client
 * component, so the page resolves the words on the server and hands them down.
 */
/**
 * A team's name wraps onto a second line before it is cut: at 360 px one line
 * left "Nassaji Maz…" and "Aluminium …" on a real match day (T-1202).
 */
const NAME = 'line-clamp-2 break-words leading-tight';

export function ScoreCard({
  card,
  timeZone,
  locale,
  now,
  showCompetition = false,
  forecast,
  community,
  viewing,
  words,
}: {
  card: ScoreCardData;
  timeZone: string;
  locale: string;
  /** The client clock, ms since epoch, so a feed that stops is caught (T-083). */
  now?: number;
  /** In the favourites block, where no competition heading says it. */
  showCompetition?: boolean;
  /**
   * T-940 (D-114): the model's line, the community's line and the viewing
   * indicator, each from its own batch and its own component. Absent (a match
   * the stream added after the page loaded) is said, never drawn empty.
   */
  forecast?: CardForecast;
  community?: CardCommunity;
  viewing?: CardViewing;
  /** The reader's words, resolved on the server (T-1303). */
  words: ScoresWords;
}) {
  const { m, p } = words;
  const n = (value: number): string => formatNumber(locale, value);
  const behind = now !== undefined && isBehind(card, now);
  // The red-card mark is an image to a screen reader, named in words (T-081).
  const sentOff = (count: number): React.ReactNode =>
    count === 0 ? null : (
      <span
        role="img"
        aria-label={
          count === 1
            ? m['scores.card.redCard'].text
            : pickPlural(p['scores.card.redCards'], locale, count).text
        }
        className="shrink-0"
      >
        {count === 1 ? '🟥' : `🟥×${n(count)}`}
      </span>
    );
  const leg = card.leg === null ? null : fill(m['scores.card.leg'].text, { leg: n(card.leg) });
  const aggregate =
    card.scores.aggregate === null
      ? null
      : fill(m['scores.card.aggregate'].text, {
          score: ltrIsolate(`${n(card.scores.aggregate.home)}–${n(card.scores.aggregate.away)}`),
        });
  const stageBits = [card.stage?.name, card.round, leg, aggregate].filter(
    (bit): bit is string => typeof bit === 'string' && bit !== '',
  );
  // What stays on the row under the teams: what changes the score's meaning.
  const rowBits = [showCompetition ? card.competition.name : null, leg, aggregate].filter(
    (bit): bit is string => bit !== null,
  );
  const live = card.status === 'live';
  const at = (iso: string) => <time dateTime={iso}>{formatKickoff(locale, iso, timeZone)}</time>;

  return (
    <li
      className="relative flex flex-col"
      data-testid="score-card"
      data-fixture-id={card.id}
      data-status={card.status}
    >
      <Link
        href={`/${locale}/match/${card.id}`}
        className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 py-2 ps-2 pe-11 hover:bg-surface-raised"
        data-testid="match-link"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`w-12 shrink-0 text-xs leading-tight hyphens-auto [overflow-wrap:anywhere] ${live ? 'font-semibold text-live' : 'text-muted'}`}
            data-testid="score-status"
          >
            {statusLabel(card, locale, timeZone, now, m)}
          </span>
          <span
            className="flex min-w-0 flex-1 items-center justify-end gap-1 text-end"
            data-testid="home-team"
          >
            <bdi className={NAME} title={card.home.name}>
              {card.home.name}
            </bdi>
            {sentOff(card.red_cards.home)}
            {/* The crest on the inner side, beside the score, in either direction (T-1321). */}
            <EntityImage media={card.home.crest} kind="crest" name={card.home.name} size={22} />
          </span>
          <LtrNumeric
            className={`shrink-0 px-1 text-center font-semibold whitespace-nowrap tabular-nums ${live ? 'text-live' : ''}`}
            testId="score"
          >
            {scoreLabel(card, locale)}
          </LtrNumeric>
          <span className="flex min-w-0 flex-1 items-center gap-1" data-testid="away-team">
            <EntityImage media={card.away.crest} kind="crest" name={card.away.name} size={22} />
            {sentOff(card.red_cards.away)}
            <bdi className={NAME} title={card.away.name}>
              {card.away.name}
            </bdi>
          </span>
        </span>
        {rowBits.length > 0 && (
          <span className="truncate ps-14 text-xs text-muted" data-testid="row-meta">
            {rowBits.join(' · ')}
          </span>
        )}
      </Link>

      {behind && (
        <p
          role="status"
          className="px-3 pb-2 text-xs font-medium text-warning"
          data-testid="behind"
        >
          <FilledMessage
            message={m['scores.card.behind']}
            params={{ time: at(card.last_updated_at) }}
          />
        </p>
      )}

      <details className="group" data-testid="card-details">
        <summary className="absolute end-0 top-0 flex size-11 cursor-pointer list-none items-center justify-center text-muted hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
          <MessageText
            className="sr-only"
            message={filled(m['scores.card.details'], {
              home: card.home.name,
              away: card.away.name,
            })}
          />
        </summary>
        <div className="flex flex-col gap-1 px-3 pb-3 text-xs">
          <p className="flex flex-wrap gap-x-3 text-muted">
            <span>{card.competition.name}</span>
            {stageBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
            <span>
              <FilledMessage
                message={m['scores.card.kickoff']}
                params={{ time: at(card.kickoff_at) }}
              />
            </span>
            {card.venue !== null && (
              <span>
                {card.venue.city === null
                  ? card.venue.name
                  : `${card.venue.name}, ${card.venue.city}`}
              </span>
            )}
          </p>

          {card.incidents.length > 0 && (
            <ul className="flex flex-wrap gap-x-3" data-testid="incidents">
              {card.incidents.map((incident, index) => (
                <li key={index}>
                  <span dir="ltr">
                    {formatMinute(locale, incident.minute, incident.added_time)}
                  </span>{' '}
                  <MessageText message={m[INCIDENT_KEY[incident.kind]]} />
                  {incident.player !== null ? ` · ${incident.player}` : ''}
                  {incident.side !== null
                    ? ` (${incident.side === 'home' ? card.home.name : card.away.name})`
                    : ''}
                </li>
              ))}
            </ul>
          )}

          {/* Two prediction products, two lines, two components (rule 6). */}
          <CardForecastSummary
            forecast={forecast}
            home={card.home.name}
            away={card.away.name}
            started={card.status !== 'scheduled'}
            locale={locale}
            timeZone={timeZone}
            words={words}
          />
          <CardCommunityTotals
            community={community}
            home={card.home.name}
            away={card.away.name}
            words={words}
          />
          <CardViewingLine viewing={viewing} locale={locale} words={words} />

          <p className="flex flex-wrap gap-x-3 text-muted" data-testid="card-labels">
            <span>
              <MessageText
                message={filled(m['scores.card.coverage'], {
                  state: m[COVERAGE_KEY[card.coverage]].text,
                })}
              />
            </span>
            <span>
              <FilledMessage
                message={m['scores.updated']}
                params={{ time: at(card.last_updated_at) }}
              />
            </span>
          </p>
        </div>
      </details>
    </li>
  );
}

/**
 * Where the match can be watched in the viewer's territory (T-940, blueprint
 * 11): a count of listings, or the sentence for why there is none. Nobody's
 * territory is guessed; without one, the line asks (T-312).
 */
/** The viewing line's words for a caller that does not pass the reader's yet. */
const ENGLISH_VIEWING: Pick<ScoresWords, 'm' | 'p'> = {
  m: Object.fromEntries(
    Object.entries({
      'scores.card.watch': 'Watch:',
      'scores.card.oneListing': 'one listing in {territory}',
      'scores.card.nothingListed': 'nothing listed in {territory}.',
      'scores.card.noSchedule': 'no schedule covers this match in {territory}.',
      'scores.card.chooseTerritory': 'choose your territory',
      'scores.card.unreachable': 'could not be loaded for this page.',
      'scores.card.notLoaded': 'not loaded for this list.',
    }).map(([key, text]) => [key, { text, status: 'source' }]),
  ) as ScoresWords['m'],
  p: {
    'scores.card.listings': {
      forms: { one: '{count} listing in {territory}', other: '{count} listings in {territory}' },
      rules: 'en-GB',
      status: 'source',
    },
  } as ScoresWords['p'],
};

export function CardViewingLine({
  viewing,
  locale,
  words = ENGLISH_VIEWING,
}: {
  viewing: CardViewing | undefined;
  locale: string;
  /** The reader's words (T-1303); the English when a caller has none yet. */
  words?: Pick<ScoresWords, 'm' | 'p'>;
}) {
  const v = viewing ?? { state: 'not_loaded' as const };
  const { m, p } = words;
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-viewing" data-state={v.state}>
      <MessageText message={m['scores.card.watch']} className="font-medium" />
      {v.state === 'listed' ? (
        <span>
          <MessageText
            message={
              v.count === 1
                ? filled(m['scores.card.oneListing'], { territory: v.territory })
                : pickPlural(p['scores.card.listings'], locale, v.count, {
                    territory: v.territory,
                  })
            }
          />
        </span>
      ) : v.state === 'nothing_listed' ? (
        <MessageText
          className="text-muted"
          message={filled(m['scores.card.nothingListed'], { territory: v.territory })}
        />
      ) : v.state === 'not_supplied' ? (
        <MessageText
          className="text-muted"
          message={filled(m['scores.card.noSchedule'], { territory: v.territory })}
        />
      ) : v.state === 'ask' ? (
        <Link href={`/${locale}/watch`} className="underline" data-testid="card-viewing-ask">
          <MessageText message={m['scores.card.chooseTerritory']} />
        </Link>
      ) : v.state === 'unreachable' ? (
        <MessageText className="text-muted" message={m['scores.card.unreachable']} />
      ) : (
        <MessageText className="text-muted" message={m['scores.card.notLoaded']} />
      )}
    </p>
  );
}
