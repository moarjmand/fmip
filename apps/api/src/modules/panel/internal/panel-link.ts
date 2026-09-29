import type {
  MatchIncidentKind,
  MatchStatMetric,
  PanelLink,
  PanelLinkRequest,
  PanelLinkedPrediction,
} from '@fmip/contracts';
import type { PanelLinkRow } from './panel-store';

/**
 * A panel post's link as a reader sees it (T-1030, D-136). Pure: the store
 * reads the post's link and what its target says now, and this decides what
 * the card may say.
 */

const KINDS = ['incident', 'player', 'prediction', 'statistic'] as const;
const SIDES = ['home', 'away'] as const;
const METRICS: readonly MatchStatMetric[] = [
  'possession_pct',
  'shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'corners',
  'offsides',
  'fouls',
  'yellow_cards',
  'red_cards',
  'passes',
  'passes_accurate',
  'pass_accuracy_pct',
  'saves',
  'expected_goals',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A link request from an untrusted body: the request, `null` for none, or a
 * sentence saying what is wrong with it. Only the shape is checked here --
 * whether the target belongs to this match is the database's question.
 */
export function parseLinkRequest(raw: unknown): PanelLinkRequest | null | string {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return 'A link must be an object.';
  const link = raw as Record<string, unknown>;
  const kind = link['kind'];
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return `A link's kind is one of ${KINDS.join(', ')}.`;
  }
  switch (kind) {
    case 'incident':
      return typeof link['incident_id'] === 'string' && UUID.test(link['incident_id'])
        ? { kind, incident_id: link['incident_id'].toLowerCase() }
        : 'An incident link needs the incident id.';
    case 'player':
      return typeof link['person_id'] === 'string' && UUID.test(link['person_id'])
        ? { kind, person_id: link['person_id'].toLowerCase() }
        : 'A player link needs the player id.';
    case 'prediction':
      return { kind };
    default: {
      const side = link['side'];
      const metric = link['metric'];
      if (!SIDES.includes(side as (typeof SIDES)[number])) {
        return 'A statistic link needs the side, home or away.';
      }
      if (!METRICS.includes(metric as MatchStatMetric)) {
        return 'A statistic link needs one of the match statistics.';
      }
      return {
        kind: 'statistic',
        side: side as 'home' | 'away',
        metric: metric as MatchStatMetric,
      };
    }
  }
}

/** What a refused link was, in the words the contributor sees (`PL020`'s HINT). */
export const LINK_REFUSAL_TEXT: Record<PanelLinkRequest['kind'], string> = {
  incident: 'That incident is not one of this match.',
  player: 'That player is in neither line-up of this match.',
  prediction: 'You have no prediction on this match to link.',
  statistic: 'That statistic is not supplied for this match.',
};

/** The fields a changed incident differs in, compared as stored. */
const COMPARED = [
  ['kind', 'incident_kind'],
  ['minute', 'minute'],
  ['added_time', 'added_time'],
  ['participant_id', 'incident_participant_id'],
  ['person_id', 'incident_person_id'],
  ['related_person_id', 'incident_related_id'],
  ['detail', 'incident_detail'],
] as const;

/** Whether the incident is as it was when linked, changed since, or gone. */
export function incidentState(row: PanelLinkRow): 'as_linked' | 'changed' | 'removed' {
  if (row.incident_id === null) return 'removed';
  const was = row.link_snapshot ?? {};
  for (const [stored, now] of COMPARED) {
    if ((was[stored] ?? null) !== (row[now] ?? null)) return 'changed';
  }
  return 'as_linked';
}

export function predictionOf(row: PanelLinkRow): PanelLinkedPrediction | null {
  if (row.outcome === null || row.confidence === null || row.submitted_at === null) return null;
  return {
    outcome: row.outcome,
    home_goals: row.home_goals,
    away_goals: row.away_goals,
    confidence: row.confidence,
    submitted_at: row.submitted_at.toISOString(),
    revised_since: row.revised_since,
  };
}

/**
 * The card. `prediction` is the author's history visibility as the public
 * panel sees it (a guest's view, D-063): `visible`, or the setting that
 * withholds it.
 */
export function linkOf(
  row: PanelLinkRow,
  prediction: 'visible' | 'friends' | 'private',
): PanelLink | null {
  switch (row.link_kind) {
    case 'incident': {
      const state = incidentState(row);
      if (state === 'removed' || row.incident_kind === null || row.minute === null) {
        // Nothing of the old incident: the card says it is gone, and a value
        // the feed no longer stands behind is not shown as current (rule 4).
        return { kind: 'incident', state: 'removed', incident: null };
      }
      return {
        kind: 'incident',
        state,
        incident: {
          kind: row.incident_kind as MatchIncidentKind,
          minute: row.minute,
          added_time: row.added_time,
          side: row.incident_side,
          player:
            row.incident_person_id === null
              ? null
              : { id: row.incident_person_id, name: row.incident_person_name ?? '' },
          related_player:
            row.incident_related_id === null
              ? null
              : { id: row.incident_related_id, name: row.incident_related_name ?? '' },
          detail: row.incident_detail,
        },
      };
    }
    case 'player':
      if (row.player_id === null) return null;
      return {
        kind: 'player',
        player: { id: row.player_id, name: row.player_name ?? '' },
        side: row.player_side,
        in_lineup: row.player_side !== null,
      };
    case 'prediction': {
      if (prediction !== 'visible') {
        return { kind: 'prediction', state: 'withheld', visibility: prediction, prediction: null };
      }
      const call = predictionOf(row);
      return call === null
        ? null
        : { kind: 'prediction', state: 'visible', visibility: null, prediction: call };
    }
    case 'statistic': {
      const at = row.link_snapshot?.['value'];
      if (row.stat_side === null || row.stat_metric === null || at === undefined) return null;
      return {
        kind: 'statistic',
        side: row.stat_side,
        metric: row.stat_metric as MatchStatMetric,
        value_at_post: Number(at),
        current: row.stat_current === null ? null : Number(row.stat_current),
      };
    }
    default:
      return null;
  }
}
