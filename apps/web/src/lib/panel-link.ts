import type {
  MatchCentre,
  MatchStatMetric,
  PanelLink,
  PanelLinkRequest,
  PanelLinkedPrediction,
} from '@fmip/contracts';
import { INCIDENT_LABEL, STAT_LABEL, minuteLabel, statValue } from '@/lib/match';

/**
 * A panel post's link on the page (T-1030, D-136): what the compose box offers
 * to link, how the choice travels in a form, and what the card says. Pure, so
 * every sentence the card can show is covered by `panel-link.spec.ts`.
 */

export interface LinkChoice {
  /** The form value: `incident:<id>`, `player:<id>`, `prediction`, `statistic:<side>:<metric>`. */
  value: string;
  label: string;
}

export interface LinkChoiceGroup {
  label: string;
  choices: LinkChoice[];
}

const METRICS = Object.keys(STAT_LABEL) as MatchStatMetric[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What this match offers to link, from the match centre the page already has.
 * Only what the feed supplied: an empty module offers nothing rather than a
 * choice the database would refuse. The author's own prediction is offered
 * only when they have one.
 */
export function linkChoices(centre: MatchCentre, hasPrediction: boolean): LinkChoiceGroup[] {
  const sideName = { home: centre.fixture.home.name, away: centre.fixture.away.name };
  const groups: LinkChoiceGroup[] = [];

  const incidents = centre.timeline.data ?? [];
  if (incidents.length > 0) {
    groups.push({
      label: 'Incidents',
      choices: incidents.map((incident) => ({
        value: `incident:${incident.id}`,
        label: [
          minuteLabel(incident.minute, incident.added_time),
          INCIDENT_LABEL[incident.kind],
          incident.player?.name,
        ]
          .filter((part) => part !== undefined && part !== '')
          .join(' '),
      })),
    });
  }

  const lineups = centre.lineups.data;
  if (lineups !== null) {
    const players = (['home', 'away'] as const).flatMap((side) =>
      lineups[side].map((player) => ({
        value: `player:${player.id}`,
        label: `${player.name} (${sideName[side]})`,
      })),
    );
    if (players.length > 0) groups.push({ label: 'Players', choices: players });
  }

  const stats = (centre.statistics.data ?? []).flatMap((row) =>
    (['home', 'away'] as const).flatMap((side) =>
      row[side] === null
        ? []
        : [
            {
              value: `statistic:${side}:${row.metric}`,
              label: `${STAT_LABEL[row.metric]}: ${sideName[side]} ${statValue(row.metric, row[side])}`,
            },
          ],
    ),
  );
  if (stats.length > 0) groups.push({ label: 'Statistics', choices: stats });

  if (hasPrediction) {
    groups.push({
      label: 'Your prediction',
      choices: [{ value: 'prediction', label: 'My prediction on this match' }],
    });
  }
  return groups;
}

/** The form value back into a request; null for no link or anything unrecognised. */
export function parseLinkChoice(value: string): PanelLinkRequest | null {
  if (value === 'prediction') return { kind: 'prediction' };
  const [kind, first, second] = value.split(':');
  if (kind === 'incident' && first !== undefined && UUID.test(first)) {
    return { kind: 'incident', incident_id: first };
  }
  if (kind === 'player' && first !== undefined && UUID.test(first)) {
    return { kind: 'player', person_id: first };
  }
  if (
    kind === 'statistic' &&
    (first === 'home' || first === 'away') &&
    METRICS.includes(second as MatchStatMetric)
  ) {
    return { kind: 'statistic', side: first, metric: second as MatchStatMetric };
  }
  return null;
}

const OUTCOME = { home: 'home win', draw: 'draw', away: 'away win' } as const;

/** One line for a member's call, labelled as theirs (rule 6). */
export function predictionLine(author: string, prediction: PanelLinkedPrediction): string {
  const score =
    prediction.home_goals === null || prediction.away_goals === null
      ? ''
      : ` ${prediction.home_goals}-${prediction.away_goals}`;
  return `${author}'s prediction: ${OUTCOME[prediction.outcome]}${score}, confidence ${prediction.confidence} of 5.`;
}

/**
 * What the card says: a heading, the lines under it, and a note when what was
 * linked is no longer as it was. Never the old value of a changed or removed
 * incident (rule 4).
 */
export function linkCard(
  link: PanelLink,
  author: string,
  names: { home: string; away: string },
  /** A withheld prediction this viewer may see (`PanelPermission.linked_predictions`). */
  revealed: PanelLinkedPrediction | null,
): { heading: string; lines: string[]; note: string | null } {
  switch (link.kind) {
    case 'incident': {
      if (link.incident === null) {
        return {
          heading: 'Linked incident',
          lines: [],
          note: 'The data feed has since removed this incident.',
        };
      }
      const i = link.incident;
      const side = i.side === null ? null : names[i.side];
      return {
        heading: 'Linked incident',
        lines: [
          [minuteLabel(i.minute, i.added_time), INCIDENT_LABEL[i.kind], i.player?.name]
            .filter((part) => part !== undefined && part !== '')
            .join(' ') + (side === null ? '' : ` (${side})`),
          ...(i.detail === null ? [] : [i.detail]),
        ],
        note:
          link.state === 'changed'
            ? 'The data feed changed this incident after it was linked. This is how it stands now.'
            : null,
      };
    }
    case 'player':
      return {
        heading: 'Linked player',
        lines: [
          link.side === null ? link.player.name : `${link.player.name} (${names[link.side]})`,
        ],
        note: link.in_lineup
          ? null
          : 'The data feed no longer lists this player in either line-up.',
      };
    case 'statistic': {
      const at = statValue(link.metric, link.value_at_post);
      return {
        heading: 'Linked statistic',
        lines: [`${STAT_LABEL[link.metric]}, ${names[link.side]}: ${at} when posted`],
        note:
          link.current === null
            ? 'The data feed no longer supplies this statistic.'
            : link.current === link.value_at_post
              ? null
              : `Now ${statValue(link.metric, link.current)}.`,
      };
    }
    case 'prediction': {
      const shown = link.prediction ?? revealed;
      if (shown === null) {
        return {
          heading: `${author}'s prediction`,
          lines: [],
          note:
            link.visibility === 'friends'
              ? 'This member shows their predictions to friends only.'
              : 'This member keeps their predictions private.',
        };
      }
      return {
        heading: `${author}'s prediction`,
        lines: [
          predictionLine(author, shown),
          "A member's own call. Not the model's forecast or the community's.",
        ],
        note: shown.revised_since ? 'They changed this call after posting.' : null,
      };
    }
  }
}
