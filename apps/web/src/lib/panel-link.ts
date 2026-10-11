import type {
  MatchCentre,
  MatchStatMetric,
  PanelLink,
  PanelLinkRequest,
  PanelLinkedPrediction,
} from '@fmip/contracts';
import { INCIDENT_KEY, STAT_KEY, incidentDetailKey, minuteLabel, statValue } from '@/lib/match';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/locales';
import { pairIsolate } from '@/components/score';
import { type MessageKey, interpolate, t } from '@/i18n/messages';

/** A catalogue sentence with its values in, in `locale` (T-1308). */
function say(locale: string, key: MessageKey, params: Record<string, string> = {}): string {
  return interpolate(t(isLocale(locale) ? locale : DEFAULT_LOCALE, key), params);
}

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
  /** Which kind of thing the group offers; the page names it in the reader's language. */
  kind: 'incidents' | 'players' | 'statistics' | 'prediction';
  label: string;
  choices: LinkChoice[];
}

const METRICS = Object.keys(STAT_KEY) as MatchStatMetric[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What this match offers to link, from the match centre the page already has.
 * Only what the feed supplied: an empty module offers nothing rather than a
 * choice the database would refuse. The author's own prediction is offered
 * only when they have one.
 */
export function linkChoices(
  centre: MatchCentre,
  hasPrediction: boolean,
  locale = 'en',
): LinkChoiceGroup[] {
  const sideName = { home: centre.fixture.home.name, away: centre.fixture.away.name };
  const groups: LinkChoiceGroup[] = [];

  const incidents = centre.timeline.data ?? [];
  if (incidents.length > 0) {
    groups.push({
      kind: 'incidents',
      label: 'Incidents',
      choices: incidents.map((incident) => ({
        value: `incident:${incident.id}`,
        label: [
          minuteLabel(incident.minute, incident.added_time, locale),
          say(locale, INCIDENT_KEY[incident.kind]),
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
    if (players.length > 0) groups.push({ kind: 'players', label: 'Players', choices: players });
  }

  const stats = (centre.statistics.data ?? []).flatMap((row) =>
    (['home', 'away'] as const).flatMap((side) =>
      row[side] === null
        ? []
        : [
            {
              value: `statistic:${side}:${row.metric}`,
              label: `${say(locale, STAT_KEY[row.metric])}: ${sideName[side]} ${statValue(row.metric, row[side], locale)}`,
            },
          ],
    ),
  );
  if (stats.length > 0) groups.push({ kind: 'statistics', label: 'Statistics', choices: stats });

  if (hasPrediction) {
    groups.push({
      kind: 'prediction',
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

const OUTCOME: Record<PanelLinkedPrediction['outcome'], MessageKey> = {
  home: 'panel.link.outcome.home',
  draw: 'panel.link.outcome.draw',
  away: 'panel.link.outcome.away',
};

/** One line for a member's call, labelled as theirs (rule 6). */
export function predictionLine(
  author: string,
  prediction: PanelLinkedPrediction,
  locale: string,
): string {
  const outcome = say(locale, OUTCOME[prediction.outcome]);
  const confidence = formatNumber(locale, prediction.confidence);
  const max = formatNumber(locale, 5);
  if (prediction.home_goals === null || prediction.away_goals === null) {
    return say(locale, 'panel.link.predictionLine', { author, outcome, confidence, max });
  }
  const bare = `${formatNumber(locale, prediction.home_goals)}-${formatNumber(locale, prediction.away_goals)}`;
  // On a right-to-left page the pair is isolated in the page's direction, so
  // the home goals stay first and on the home side (rule 7, D-193, T-1378).
  const page = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const score = directionOf(page) === 'rtl' ? pairIsolate(page, bare) : bare;
  return say(locale, 'panel.link.predictionLineScore', { author, outcome, score, confidence, max });
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
  locale: string,
): { heading: string; lines: string[]; note: string | null } {
  const withSide = (name: string, side: string | null): string =>
    side === null ? name : say(locale, 'panel.link.withSide', { name, side });
  switch (link.kind) {
    case 'incident': {
      if (link.incident === null) {
        return {
          heading: say(locale, 'panel.link.incident'),
          lines: [],
          note: say(locale, 'panel.link.incidentGone'),
        };
      }
      const i = link.incident;
      const side = i.side === null ? null : names[i.side];
      const detailKey = incidentDetailKey(i.detail);
      return {
        heading: say(locale, 'panel.link.incident'),
        lines: [
          withSide(
            [
              minuteLabel(i.minute, i.added_time, locale),
              say(locale, INCIDENT_KEY[i.kind]),
              i.player?.name,
            ]
              .filter((part) => part !== undefined && part !== '')
              .join(' '),
            side,
          ),
          // A VAR review's decision in the reader's words, never the provider's (T-1378).
          ...(detailKey === null ? [] : [say(locale, detailKey)]),
        ],
        note: link.state === 'changed' ? say(locale, 'panel.link.incidentChanged') : null,
      };
    }
    case 'player':
      return {
        heading: say(locale, 'panel.link.player'),
        lines: [withSide(link.player.name, link.side === null ? null : names[link.side])],
        note: link.in_lineup ? null : say(locale, 'panel.link.playerGone'),
      };
    case 'statistic': {
      const at = statValue(link.metric, link.value_at_post, locale);
      return {
        heading: say(locale, 'panel.link.statistic'),
        lines: [
          say(locale, 'panel.link.statisticLine', {
            metric: say(locale, STAT_KEY[link.metric]),
            side: names[link.side],
            value: at,
          }),
        ],
        note:
          link.current === null
            ? say(locale, 'panel.link.statisticGone')
            : link.current === link.value_at_post
              ? null
              : say(locale, 'panel.link.statisticNow', {
                  value: statValue(link.metric, link.current, locale),
                }),
      };
    }
    case 'prediction': {
      const shown = link.prediction ?? revealed;
      if (shown === null) {
        return {
          heading: say(locale, 'panel.link.prediction', { author }),
          lines: [],
          note: say(
            locale,
            link.visibility === 'friends'
              ? 'panel.link.predictionFriends'
              : 'panel.link.predictionPrivate',
          ),
        };
      }
      return {
        heading: say(locale, 'panel.link.prediction', { author }),
        lines: [predictionLine(author, shown, locale), say(locale, 'panel.link.predictionOwn')],
        note: shown.revised_since ? say(locale, 'panel.link.predictionRevised') : null,
      };
    }
  }
}
