import { formatNumber } from '@/i18n/format';
import { fill } from '@/lib/words';

/**
 * A stage name or a round in the reader's words (T-1339). The provider names
 * them in English ("League A", "Group Stage", "Regular Season - 12",
 * "League A - 1") and the API passes them on as data; the label is the page's
 * to translate. Known names and the forms built from them are looked up in
 * the catalogue; anything else is returned exactly as it came, never guessed.
 * In English every label equals its input.
 *
 * Pure and catalogue-free, so a client component can use it with the words
 * its server page resolved (`STAGE_KEYS` are in `SCORES_KEYS` and `MATCH_KEYS`).
 */

export const STAGE_KEYS = [
  'stage.name.regularSeason',
  'stage.name.leagueStage',
  'stage.name.groupStage',
  'stage.name.groups',
  'stage.name.preliminaryRound',
  'stage.name.qualifying1',
  'stage.name.qualifying2',
  'stage.name.qualifying3',
  'stage.name.playOffs',
  'stage.name.knockoutPlayOffs',
  'stage.name.roundOf32',
  'stage.name.roundOf16',
  'stage.name.quarterFinals',
  'stage.name.semiFinals',
  'stage.name.final',
  'stage.name.thirdPlace',
  'stage.league',
  'stage.group',
  'stage.round',
  'stage.matchday',
] as const;

export type StageKey = (typeof STAGE_KEYS)[number];

/** The provider's names, exactly as it spells them. */
const NAMES: ReadonlyMap<string, StageKey> = new Map([
  ['Regular Season', 'stage.name.regularSeason'],
  ['League Stage', 'stage.name.leagueStage'],
  ['Group Stage', 'stage.name.groupStage'],
  ['Groups', 'stage.name.groups'],
  ['Preliminary Round', 'stage.name.preliminaryRound'],
  ['1st Qualifying Round', 'stage.name.qualifying1'],
  ['2nd Qualifying Round', 'stage.name.qualifying2'],
  ['3rd Qualifying Round', 'stage.name.qualifying3'],
  ['Play-offs', 'stage.name.playOffs'],
  ['Knockout Round Play-offs', 'stage.name.knockoutPlayOffs'],
  ['Round of 32', 'stage.name.roundOf32'],
  ['Round of 16', 'stage.name.roundOf16'],
  ['Quarter-finals', 'stage.name.quarterFinals'],
  ['Semi-finals', 'stage.name.semiFinals'],
  ['Final', 'stage.name.final'],
  ['3rd Place Final', 'stage.name.thirdPlace'],
]);

const LEAGUE = /^League ([A-Z])$/;
const GROUP_LETTER = /^Group ([A-Z])$/;
const GROUP_NUMBER = /^Group ([1-9][0-9]?)$/;
/** "<stage> - <n>": the provider's round within a stage. */
const ROUND = /^(.+) - ([1-9][0-9]{0,2})$/;

type Say = (key: StageKey) => string;

function nameOf(text: string, say: Say, locale: string): string | null {
  const key = NAMES.get(text);
  if (key !== undefined) return say(key);
  const league = LEAGUE.exec(text);
  if (league?.[1] !== undefined) return fill(say('stage.league'), { letter: league[1] });
  const letter = GROUP_LETTER.exec(text);
  if (letter?.[1] !== undefined) return fill(say('stage.group'), { group: letter[1] });
  const number = GROUP_NUMBER.exec(text);
  if (number?.[1] !== undefined) {
    return fill(say('stage.group'), { group: formatNumber(locale, Number(number[1])) });
  }
  return null;
}

/**
 * "League A - 1" → «لیگ A، هفته‌ی ۱»; "Regular Season - 12" → «هفته‌ی ۱۲»;
 * "Group Stage" → «مرحله‌ی گروهی». An unknown text comes back unchanged.
 */
export function stageLabel(text: string, say: Say, locale: string): string {
  const name = nameOf(text, say, locale);
  if (name !== null) return name;
  const round = ROUND.exec(text);
  if (round?.[1] !== undefined && round[2] !== undefined) {
    const n = formatNumber(locale, Number(round[2]));
    if (round[1] === 'Regular Season') return fill(say('stage.matchday'), { round: n });
    const stage = nameOf(round[1], say, locale);
    if (stage !== null) return fill(say('stage.round'), { stage, round: n });
  }
  return text;
}
