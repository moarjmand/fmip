import type { ScoreCard as ScoreCardData, ScoreCardIncident } from '@fmip/contracts';
import Link from 'next/link';
import { isBehind } from '@/lib/live';
import { COVERAGE_LABEL, formatKickoff, scoreLabel, statusLabel } from '@/lib/scores';
import type { CardCommunity, CardForecast, CardViewing } from '@/lib/score-card-products';
import { LtrNumeric, ltrIsolate } from '@/components/score';
import { CardCommunityTotals } from '@/components/score-card-community';
import { CardForecastSummary } from '@/components/score-card-forecast';

const INCIDENT_LABEL: Record<ScoreCardIncident['kind'], string> = {
  goal: 'Goal',
  own_goal: 'Own goal',
  penalty_goal: 'Penalty',
  penalty_missed: 'Penalty missed',
  red_card: 'Red card',
  second_yellow_card: 'Second yellow',
  var: 'VAR',
};

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
}) {
  const behind = now !== undefined && isBehind(card, now);
  // The red-card mark is an image to a screen reader, named in words (T-081).
  const sentOff = (n: number): React.ReactNode =>
    n === 0 ? null : (
      <span
        role="img"
        aria-label={n === 1 ? 'one red card' : `${n} red cards`}
        className="shrink-0"
      >
        {n === 1 ? '🟥' : `🟥×${n}`}
      </span>
    );
  const stageBits = [
    card.stage?.name,
    card.round,
    card.leg === null ? null : `Leg ${card.leg}`,
    card.scores.aggregate === null
      ? null
      : `Agg ${ltrIsolate(`${card.scores.aggregate.home}–${card.scores.aggregate.away}`)}`,
  ].filter((bit): bit is string => typeof bit === 'string' && bit !== '');
  // What stays on the row under the teams: what changes the score's meaning.
  const rowBits = [
    showCompetition ? card.competition.name : null,
    card.leg === null ? null : `Leg ${card.leg}`,
    card.scores.aggregate === null
      ? null
      : `Agg ${ltrIsolate(`${card.scores.aggregate.home}–${card.scores.aggregate.away}`)}`,
  ].filter((bit): bit is string => bit !== null);
  const live = card.status === 'live';

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
            {statusLabel(card, locale, timeZone, now)}
          </span>
          <span
            className="flex min-w-0 flex-1 items-center justify-end gap-1 text-end"
            data-testid="home-team"
          >
            <bdi className={NAME} title={card.home.name}>
              {card.home.name}
            </bdi>
            {sentOff(card.red_cards.home)}
          </span>
          <LtrNumeric
            className={`shrink-0 px-1 text-center font-semibold whitespace-nowrap tabular-nums ${live ? 'text-live' : ''}`}
            testId="score"
          >
            {scoreLabel(card)}
          </LtrNumeric>
          <span className="flex min-w-0 flex-1 items-center gap-1" data-testid="away-team">
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
          Data behind: nothing has changed since{' '}
          <time dateTime={card.last_updated_at}>
            {formatKickoff(locale, card.last_updated_at, timeZone)}
          </time>
          . The score shown is the last known, not the current one.
        </p>
      )}

      <details className="group" data-testid="card-details">
        <summary className="absolute end-0 top-0 flex size-11 cursor-pointer list-none items-center justify-center text-muted hover:bg-surface-raised [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
          <span className="sr-only">
            Details: {card.home.name} v {card.away.name}
          </span>
        </summary>
        <div className="flex flex-col gap-1 px-3 pb-3 text-xs">
          <p className="flex flex-wrap gap-x-3 text-muted">
            <span>{card.competition.name}</span>
            {stageBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
            <span>
              Kick-off{' '}
              <time dateTime={card.kickoff_at}>
                {formatKickoff(locale, card.kickoff_at, timeZone)}
              </time>
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
                  {incident.minute}
                  {incident.added_time !== null ? `+${incident.added_time}` : ''}′{' '}
                  {INCIDENT_LABEL[incident.kind]}
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
          />
          <CardCommunityTotals community={community} home={card.home.name} away={card.away.name} />
          <CardViewingLine viewing={viewing} locale={locale} />

          <p className="flex flex-wrap gap-x-3 text-muted" data-testid="card-labels">
            <span>Scores: {COVERAGE_LABEL[card.coverage]}</span>
            <span>
              Updated{' '}
              <time dateTime={card.last_updated_at}>
                {formatKickoff(locale, card.last_updated_at, timeZone)}
              </time>
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
export function CardViewingLine({
  viewing,
  locale,
}: {
  viewing: CardViewing | undefined;
  locale: string;
}) {
  const v = viewing ?? { state: 'not_loaded' as const };
  return (
    <p className="flex flex-wrap gap-x-2" data-testid="card-viewing" data-state={v.state}>
      <span className="font-medium">Watch:</span>
      {v.state === 'listed' ? (
        <span>
          {v.count === 1 ? 'one listing' : `${v.count} listings`} in {v.territory}
        </span>
      ) : v.state === 'nothing_listed' ? (
        <span className="text-muted">nothing listed in {v.territory}.</span>
      ) : v.state === 'not_supplied' ? (
        <span className="text-muted">no schedule covers this match in {v.territory}.</span>
      ) : v.state === 'ask' ? (
        <Link href={`/${locale}/watch`} className="underline" data-testid="card-viewing-ask">
          choose your territory
        </Link>
      ) : v.state === 'unreachable' ? (
        <span className="text-muted">could not be loaded for this page.</span>
      ) : (
        <span className="text-muted">not loaded for this list.</span>
      )}
    </p>
  );
}
