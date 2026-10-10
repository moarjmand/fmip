import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { intlLocale } from '@/i18n/format';
import {
  EN,
  TRANSLATION_FILES,
  resolveMessages,
  type MessageKey,
  type PluralForms,
  type PluralKey,
} from '@/i18n/messages';
import { STAGE_KEYS } from '@/lib/stage-label';
import type { ClientPlural, ClientWords } from '@/lib/words';

/**
 * The words the live surfaces need, resolved on the server for the reader's
 * locale and handed to their client components (T-1303, T-1040). Server
 * only: it reads the catalogues. The lists are the whole vocabulary of the
 * scores list and the match centre's live part; a key a client component
 * uses and this list lacks is a type error there.
 */

/** A plural's forms in `locale`, or the English marked `untranslated`, as `plural()` chooses. */
export function resolvePlural(locale: string, key: PluralKey): ClientPlural {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const source = EN[key] as PluralForms;
  if (resolved === DEFAULT_LOCALE) {
    return { forms: source, rules: intlLocale(DEFAULT_LOCALE), status: 'source' };
  }
  const entry = (TRANSLATION_FILES as Partial<Record<Locale, (typeof TRANSLATION_FILES)['fa']>>)[
    resolved
  ]?.[key];
  const forms = entry?.forms;
  const has = forms !== undefined && typeof forms.other === 'string' && forms.other !== '';
  return has
    ? { forms: forms as ClientPlural['forms'], rules: intlLocale(resolved), status: 'translated' }
    : { forms: source, rules: intlLocale(DEFAULT_LOCALE), status: 'untranslated' };
}

function resolveWords<K extends MessageKey, P extends PluralKey>(
  locale: string,
  keys: readonly K[],
  plurals: readonly P[],
): ClientWords<K, P> {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    locale,
    m: resolveMessages(resolved, keys),
    p: Object.fromEntries(plurals.map((key) => [key, resolvePlural(locale, key)])) as Record<
      P,
      ClientPlural
    >,
  };
}

/** A live fixture's status cell and a coverage state: both surfaces say them. */
const STATUS_KEYS = [
  'status.live',
  'status.behind',
  'status.fullTime',
  'status.afterExtraTime',
  'status.penalties',
  'status.halfTime',
  'status.aggregate',
  'status.postponed',
  'status.suspended',
  'status.cancelled',
  'status.abandoned',
  'status.awarded',
  'status.coverage.available',
  'status.coverage.limited',
  'status.coverage.notSupplied',
  'status.coverage.delayed',
] as const;

/** The freshness line and the screen reader's announcements, on both surfaces. */
const LIVE_KEYS = [
  'scores.live.connecting',
  'scores.live.updated',
  'scores.live.stale',
  'scores.live.staleAt',
  'scores.live.unavailable',
  'scores.announce.kickOff',
  'scores.announce.fullTime',
  'scores.announce.awarded',
  'scores.announce.status',
  'scores.announce.scoreLine',
  'scores.announce.against',
  'scores.announce.corrected',
  'scores.announce.goal',
  'scores.announce.redCard',
] as const;

/** A goal, a card, a change: named the same on the card and in the timeline. */
const INCIDENT_KEYS = [
  'matchCentre.incident.goal',
  'matchCentre.incident.ownGoal',
  'matchCentre.incident.penaltyGoal',
  'matchCentre.incident.penaltyMissed',
  'matchCentre.incident.yellowCard',
  'matchCentre.incident.secondYellow',
  'matchCentre.incident.redCard',
  'matchCentre.incident.substitution',
  'matchCentre.incident.var',
] as const;

export const SCORES_KEYS = [
  ...STATUS_KEYS,
  ...LIVE_KEYS,
  ...INCIDENT_KEYS,
  ...STAGE_KEYS,
  'scores.empty',
  'scores.filteredEmpty',
  'scores.filter.clear',
  'scores.favourites',
  'scores.loadedAt',
  'scores.updated',
  'scores.updatedBetween',
  'scores.card.leg',
  'scores.card.aggregate',
  'scores.card.redCard',
  'scores.card.oneListing',
  'scores.card.behind',
  'scores.card.details',
  'scores.card.kickoff',
  'scores.card.coverage',
  'scores.card.watch',
  'scores.card.nothingListed',
  'scores.card.noSchedule',
  'scores.card.chooseTerritory',
  'scores.card.unreachable',
  'scores.card.notLoaded',
  'scores.card.lineUnreachable',
  'scores.card.lineNotLoaded',
  'scores.card.draw',
  'scores.card.model.label',
  'scores.card.model.version',
  'scores.card.model.noProbabilities',
  'scores.card.model.couldNotAnswer',
  'scores.card.model.noneBefore',
  'scores.card.model.notYet',
  'scores.card.community.label',
  'forecast.reason.teamNotMapped',
  'forecast.reason.noHistory',
  'forecast.reason.divisionNotLoaded',
  'forecast.reason.competitionNotMapped',
  'forecast.reason.crossCompetition',
  'forecast.reason.modelUnreachable',
  'forecast.reason.contractViolation',
] as const;

export const SCORES_PLURALS = [
  'scores.card.redCards',
  'scores.card.listings',
  'scores.card.community.sample',
  'scores.card.community.belowFloor',
] as const;

export type ScoresWords = ClientWords<
  (typeof SCORES_KEYS)[number],
  (typeof SCORES_PLURALS)[number]
>;

export function scoresWords(locale: string): ScoresWords {
  return resolveWords(locale, SCORES_KEYS, SCORES_PLURALS);
}

export const MATCH_KEYS = [
  ...STATUS_KEYS,
  ...LIVE_KEYS,
  ...INCIDENT_KEYS,
  ...STAGE_KEYS,
  // What a VAR review decided, in the timeline (T-1378).
  'matchCentre.incidentDetail.goalCancelled',
  'matchCentre.incidentDetail.goalConfirmed',
  'matchCentre.incidentDetail.penaltyAwarded',
  'matchCentre.incidentDetail.penaltyCancelled',
  'matchCentre.incidentDetail.penaltyConfirmed',
  'matchCentre.incidentDetail.cardUpgraded',
  'matchCentre.incidentDetail.cardCancelled',
  'scores.card.leg',
  'scores.card.kickoff',
  'matchCentre.group',
  'matchCentre.behind',
  'matchCentre.neutralVenue',
  'matchCentre.referee',
  'matchCentre.attendance',
  'matchCentre.lastUpdate',
  'matchCentre.lastChecked',
  'matchCentre.onThisPage',
  'matchCentre.nav.timeline',
  'matchCentre.nav.stats',
  'matchCentre.nav.context',
  'matchCentre.lineups',
  'matchCentre.keyPlayers.title',
  'forecast.title',
  'matchCentre.nav.analysis',
  'matchCentre.nav.community',
  'matchCentre.nav.discussion',
  'nav.watch',
  'nav.news',
  'matchCentre.timeline',
  'matchCentre.statistics',
  'matchCentre.playerStatistics',
  'matchCentre.recentForm',
  'matchCentre.headToHead',
  'player.availability.title',
  'matchCentre.coverage',
  'matchCentre.moduleCoverage',
  'matchCentre.notYet',
  'matchCentre.moduleDelayed',
  'matchCentre.moduleNotSupplied',
  'matchCentre.lineupsNotYet',
  'matchCentre.absencesNotCovered',
  'matchCentre.absencesNotYet',
  'matchCentre.assist',
  'matchCentre.stat.possession',
  'matchCentre.stat.shots',
  'matchCentre.stat.shotsOnTarget',
  'matchCentre.stat.shotsOffTarget',
  'matchCentre.stat.blockedShots',
  'matchCentre.stat.corners',
  'matchCentre.stat.offsides',
  'matchCentre.stat.fouls',
  'matchCentre.stat.yellowCards',
  'matchCentre.stat.redCards',
  'matchCentre.stat.passes',
  'matchCentre.stat.passesAccurate',
  'matchCentre.stat.passAccuracy',
  'matchCentre.stat.saves',
  'matchCentre.stat.expectedGoals',
  'matchCentre.xgNotSupplied',
  'matchCentre.playerColumn',
  'matchCentre.player.minutes',
  'matchCentre.player.rating',
  'matchCentre.player.goals',
  'matchCentre.player.assists',
  'matchCentre.player.shots',
  'matchCentre.player.keyPasses',
  'matchCentre.player.tackles',
  'matchCentre.playerXgNotSupplied',
  'matchCentre.noAbsences',
  'matchCentre.noAbsencesAsked',
  'player.availability.stale',
  'matchCentre.out',
  'matchCentre.doubtful',
  'matchCentre.coach',
  'matchCentre.captain',
  'matchCentre.bench',
  'matchCentre.noForm',
  'matchCentre.form.won',
  'matchCentre.form.drawn',
  'matchCentre.form.lost',
  'matchCentre.form.versus',
  'matchCentre.form.at',
  'matchCentre.module.scores',
  'matchCentre.module.incidents',
  'matchCentre.module.lineups',
  'matchCentre.module.statistics',
  'matchCentre.module.standings',
  'matchCentre.module.availability',
  'matchCentre.module.advancedStatistics',
] as const;

export type MatchWords = ClientWords<(typeof MATCH_KEYS)[number]>;

export function matchWords(locale: string): MatchWords {
  return resolveWords(locale, MATCH_KEYS, []);
}
