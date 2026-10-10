import { formatNumber } from '@/i18n/format';
import { fill } from '@/lib/words';

/**
 * A stage name or a round in the reader's words (T-1339, T-1375). The
 * provider names them in English ("League A", "Group Stage", "Regular Season -
 * 12", "League A - 1", "Friendly International") and the API passes them on as
 * data; the label is the page's to translate. Known names and the forms built
 * from them are looked up in the catalogue. A text none of them matches is
 * **not shown** (`null`), in any locale: the provider's own wording never
 * reaches the page unmapped (rule 2, T-1375), and nothing is guessed. A round
 * number under a stage we cannot name still reads as "Round n".
 *
 * In English every name the provider spells the way we do reads as its input.
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
  'stage.name.qualifying',
  'stage.name.playOffs',
  'stage.name.knockoutPlayOffs',
  'stage.name.roundOf32',
  'stage.name.roundOf16',
  'stage.name.quarterFinals',
  'stage.name.semiFinals',
  'stage.name.final',
  'stage.name.thirdPlace',
  'stage.name.friendly',
  'stage.name.championshipRound',
  'stage.name.relegationRound',
  'stage.league',
  'stage.group',
  'stage.round',
  'stage.matchday',
  'stage.roundNumber',
  'stage.roundOf',
  'stage.qualifyingNumber',
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
  ['Qualifying Round', 'stage.name.qualifying'],
  ['Qualifying', 'stage.name.qualifying'],
  ['Play-offs', 'stage.name.playOffs'],
  ['Knockout Round Play-offs', 'stage.name.knockoutPlayOffs'],
  ['Round of 32', 'stage.name.roundOf32'],
  ['Round of 16', 'stage.name.roundOf16'],
  ['Quarter-finals', 'stage.name.quarterFinals'],
  ['Semi-finals', 'stage.name.semiFinals'],
  ['Final', 'stage.name.final'],
  ['3rd Place Final', 'stage.name.thirdPlace'],
  ['Friendly International', 'stage.name.friendly'],
  ['Friendlies', 'stage.name.friendly'],
  ['Club Friendlies', 'stage.name.friendly'],
  ['Championship Round', 'stage.name.championshipRound'],
  ['Relegation Round', 'stage.name.relegationRound'],
]);

/** A count or a round as the provider writes it: no leading zero. */
const N = '([1-9][0-9]{0,2})';
const LEAGUE = /^League ([A-Z])$/;
const GROUP_LETTER = /^Group ([A-Z])$/;
const GROUP_NUMBER = /^Group ([1-9][0-9]?)$/;
/** "<stage> - <n>": the provider's round within a stage. */
const ROUND = new RegExp(`^(.+) - ${N}$`);
/** "Round of 64": a knockout round by the clubs left in it. */
const ROUND_OF = new RegExp(`^Round of ${N}$`);
/** "1st Round", "Round 3", "Matchday 4", "Matchweek 20": a numbered round. */
const ROUND_NUMBER = new RegExp(
  `^(?:${N}(?:st|nd|rd|th) Round|(?:Round|Matchday|Matchweek) ${N})$`,
);
/** "4th Qualifying Round": past the three the catalogue spells out. */
const QUALIFYING_NUMBER = new RegExp(`^${N}(?:st|nd|rd|th) Qualifying Round$`);

type Say = (key: StageKey) => string;

function nameOf(text: string, say: Say, locale: string): string | null {
  const key = NAMES.get(text);
  if (key !== undefined) return say(key);
  const number = (digits: string): string => formatNumber(locale, Number(digits));
  const league = LEAGUE.exec(text);
  if (league?.[1] !== undefined) return fill(say('stage.league'), { letter: league[1] });
  const letter = GROUP_LETTER.exec(text);
  if (letter?.[1] !== undefined) return fill(say('stage.group'), { group: letter[1] });
  const group = GROUP_NUMBER.exec(text);
  if (group?.[1] !== undefined) return fill(say('stage.group'), { group: number(group[1]) });
  const roundOf = ROUND_OF.exec(text);
  if (roundOf?.[1] !== undefined) return fill(say('stage.roundOf'), { count: number(roundOf[1]) });
  const qualifying = QUALIFYING_NUMBER.exec(text);
  if (qualifying?.[1] !== undefined) {
    return fill(say('stage.qualifyingNumber'), { round: number(qualifying[1]) });
  }
  const numbered = ROUND_NUMBER.exec(text);
  const n = numbered?.[1] ?? numbered?.[2];
  if (n !== undefined) return fill(say('stage.roundNumber'), { round: number(n) });
  return null;
}

/**
 * "League A - 1" → «لیگ A، هفته‌ی ۱»; "Regular Season - 12" → «هفته‌ی ۱۲»;
 * "Group Stage" → «مرحله‌ی گروهی»; "Something New - 3" → «دور ۳». A text
 * nothing here recognises is `null`: leave the label out, never print it.
 */
export function stageLabel(text: string, say: Say, locale: string): string | null {
  const name = nameOf(text, say, locale);
  if (name !== null) return name;
  const round = ROUND.exec(text);
  if (round?.[1] !== undefined && round[2] !== undefined) {
    const n = formatNumber(locale, Number(round[2]));
    if (round[1] === 'Regular Season') return fill(say('stage.matchday'), { round: n });
    const stage = nameOf(round[1], say, locale);
    if (stage !== null) return fill(say('stage.round'), { stage, round: n });
    // A stage we cannot name: its round number is still ours to say.
    return fill(say('stage.roundNumber'), { round: n });
  }
  return null;
}

/**
 * The labels for a stage and a round, each once (T-1343) and each in the
 * reader's words, the ones we cannot name left out (T-1375).
 */
export function stageAndRoundLabels(
  stage: string | null | undefined,
  round: string | null | undefined,
  say: Say,
  locale: string,
): string[] {
  return stageAndRound(stage, round)
    .map((text) => stageLabel(text, say, locale))
    .filter((label): label is string => label !== null && label !== '');
}

/**
 * The provider's stage and round to show, each once (T-1343): the stage is
 * left out when the round already names it ("League A" with "League A - 2"
 * is only «لیگ A، هفته‌ی ۲»; "Regular Season" with "Regular Season - 12" is
 * only «هفته‌ی ۱۲»). Raw provider texts in, raw texts out, in reading order;
 * `stageAndRoundLabels` is what a page shows.
 */
export function stageAndRound(
  stage: string | null | undefined,
  round: string | null | undefined,
): string[] {
  const s = typeof stage === 'string' && stage !== '' ? stage : null;
  const r = typeof round === 'string' && round !== '' ? round : null;
  if (s !== null && r !== null && (r === s || r.startsWith(`${s} - `))) return [r];
  return [s, r].filter((text): text is string => text !== null);
}
