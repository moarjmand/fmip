import type { ScoreCard as ScoreCardData, ScoreCardIncident } from '@fmip/contracts';
import { COVERAGE_LABEL, formatKickoff, scoreLabel, statusLabel } from '@/lib/scores';

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
 * One match on the scores list (blueprint 4.1). Everything shown is in the
 * card the API sent; what the platform does not have yet is labelled as such
 * rather than left as an empty slot (rule 3): the forecast summary arrives
 * with T-065, community totals with E5, viewing availability with Phase 2.
 */
export function ScoreCard({ card, timeZone }: { card: ScoreCardData; timeZone: string }) {
  const sentOff = (n: number): string => (n === 0 ? '' : n === 1 ? ' 🟥' : ` 🟥×${n}`);
  const stageBits = [
    card.stage?.name,
    card.round,
    card.leg === null ? null : `Leg ${card.leg}`,
    card.scores.aggregate === null
      ? null
      : `Agg ${card.scores.aggregate.home}–${card.scores.aggregate.away}`,
  ].filter((bit): bit is string => typeof bit === 'string' && bit !== '');

  return (
    <li
      className="flex flex-col gap-1 rounded border border-current/20 p-3"
      data-testid="score-card"
      data-fixture-id={card.id}
      data-status={card.status}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-16 shrink-0 text-sm ${card.status === 'live' ? 'font-semibold' : 'opacity-70'}`}
          data-testid="score-status"
        >
          {statusLabel(card, timeZone)}
        </span>
        <span className="flex-1 truncate text-end" data-testid="home-team">
          {card.home.name}
          {sentOff(card.red_cards.home)}
        </span>
        <span
          className="w-16 shrink-0 text-center text-lg font-semibold tabular-nums"
          data-testid="score"
        >
          {scoreLabel(card)}
        </span>
        <span className="flex-1 truncate" data-testid="away-team">
          {sentOff(card.red_cards.away)}
          {card.away.name}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 text-xs opacity-70">
        <span>{card.competition.name}</span>
        {stageBits.map((bit) => (
          <span key={bit}>{bit}</span>
        ))}
        <span>
          Kick-off{' '}
          <time dateTime={card.kickoff_at}>{formatKickoff(card.kickoff_at, timeZone)}</time>
        </span>
        {card.venue !== null && (
          <span>
            {card.venue.city === null ? card.venue.name : `${card.venue.name}, ${card.venue.city}`}
          </span>
        )}
      </div>

      {card.incidents.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 text-xs" data-testid="incidents">
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

      <div className="flex flex-wrap gap-x-3 text-xs opacity-60" data-testid="card-labels">
        <span>Scores: {COVERAGE_LABEL[card.coverage]}</span>
        <span>Forecast: not on this page yet</span>
        <span>Community: unsupported</span>
        <span>Watch: unsupported</span>
        <span>
          Updated{' '}
          <time dateTime={card.last_updated_at}>
            {formatKickoff(card.last_updated_at, timeZone)}
          </time>
        </span>
      </div>
    </li>
  );
}
