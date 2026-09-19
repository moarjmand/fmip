import type { MatchFacts } from './match-facts';

/**
 * The grounding gate (T-411): mechanical, in code, before anybody sees a
 * summary. A sentence that reads well and is wrong about who scored is
 * worse than no sentence, and no reader can tell from the prose -- so the
 * gate does not read the prose. It checks two things the record can settle:
 *
 * - every number in the text is a number in the facts (a score, a minute, a
 *   statistic, an attendance, a percentage, a year of the season);
 * - every capitalised name in the text, other than at the start of a
 *   sentence, is a name the facts hold (a team, a person, a place, the
 *   competition, the stage) or a word inside one.
 *
 * It is a heuristic and it says so: it will refuse a true sentence that
 * names a fact the record lacks, which is the right way round -- the record
 * is what the product stands behind, and a summary is of the record.
 */
export type Grounding = { ok: true } | { ok: false; reason: string };

/** Words that start with a capital in ordinary prose and are not names. */
const ORDINARY = new Set([
  'VAR',
  'Premier',
  'League',
  'Cup',
  'United',
  'City',
  'FC',
  'AFC',
  'The',
  'A',
  'An',
  'In',
  'On',
  'At',
  'After',
  'Before',
  'With',
  'By',
  'But',
  'And',
  'It',
  'He',
  'They',
  'Their',
  'His',
  'Both',
  'Neither',
  'Half',
  'First',
  'Second',
  'Extra',
  'Penalties',
  'Full',
  'Time',
  'Kick',
]);

export function vocabularyOf(facts: MatchFacts): { names: string[]; numbers: Set<string> } {
  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (value !== null && value !== undefined && value.trim() !== '') names.add(value.trim());
  };
  add(facts.match.competition);
  add(facts.match.stage);
  add(facts.match.venue);
  add(facts.match.city);
  add(facts.match.referee);
  for (const side of [facts.home, facts.away]) {
    add(side.name);
    add(side.coach);
  }
  for (const i of facts.timeline.incidents) {
    add(i.player);
    add(i.related_player);
  }
  for (const side of [facts.lineups.home, facts.lineups.away]) for (const p of side) add(p.name);
  for (const side of [facts.form.home, facts.form.away]) for (const e of side) add(e.opponent);
  for (const h of facts.head_to_head.entries) {
    add(h.home);
    add(h.away);
  }

  const numbers = new Set<string>();
  const addNumber = (value: number | null | undefined) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      numbers.add(String(value));
      if (Number.isInteger(value)) return;
      numbers.add(String(Math.round(value)));
    }
  };
  for (const line of Object.values(facts.score)) {
    if (line !== null) {
      addNumber(line.home);
      addNumber(line.away);
    }
  }
  addNumber(facts.match.attendance);
  for (const part of facts.match.season.split(/[^0-9]+/)) {
    if (part !== '') {
      numbers.add(part);
      // "2025/26" is also said as 2026.
      if (part.length === 2) numbers.add(`20${part}`);
    }
  }
  for (const i of facts.timeline.incidents) {
    addNumber(i.minute);
    addNumber(i.added_time);
    if (i.added_time !== null) numbers.add(`${i.minute}+${i.added_time}`);
  }
  for (const r of facts.statistics.rows) {
    addNumber(r.home);
    addNumber(r.away);
  }
  for (const side of [facts.form.home, facts.form.away]) {
    for (const e of side) {
      addNumber(e.goals_for);
      addNumber(e.goals_against);
    }
  }
  for (const h of facts.head_to_head.entries) {
    addNumber(h.full_time.home);
    addNumber(h.full_time.away);
    numbers.add(h.kickoff_at.slice(0, 4));
  }
  if (facts.forecast.probabilities !== null) {
    for (const v of Object.values(facts.forecast.probabilities)) addNumber(v);
  }
  addNumber(facts.consensus.sample);
  if (facts.consensus.crowd !== null)
    for (const v of Object.values(facts.consensus.crowd)) addNumber(v);
  // Small counts a report says in words or digits either way: a red card, two goals, three points.
  for (let n = 0; n <= 5; n += 1) numbers.add(String(n));
  return { names: [...names], numbers };
}

export function checkGrounding(text: string, facts: MatchFacts): Grounding {
  const { names, numbers } = vocabularyOf(facts);
  const known = names.join(' | ').toLowerCase();

  // A digit inside a name -- "Schalke 04", "1899 Hoffenheim" -- is the name's, not
  // a number the text asserts; names are taken out before numbers are read.
  const withoutNames = names.reduce((rest, name) => rest.split(name).join(' '), text);
  for (const match of withoutNames.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = match[0].replace(',', '.');
    if (!numbers.has(raw) && !numbers.has(String(Number(raw)))) {
      return { ok: false, reason: `number not in the record: ${match[0]}` };
    }
  }

  // Capitalised runs not at the start of a sentence: "Mohamed Salah", "Old Trafford".
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    let index = 1;
    while (index < words.length) {
      const word = words[index] ?? '';
      const clean = word.replace(/^[("'“‘]+|[)"'”’,.;:!?]+$/g, '');
      if (/^\p{Lu}[\p{L}'’-]*$/u.test(clean) && !ORDINARY.has(clean)) {
        let end = index + 1;
        let run = clean;
        while (end < words.length) {
          const next = (words[end] ?? '').replace(/^[("'“‘]+|[)"'”’,.;:!?]+$/g, '');
          if (/^\p{Lu}[\p{L}'’-]*$/u.test(next) && !ORDINARY.has(next)) {
            run = `${run} ${next}`;
            end += 1;
          } else break;
        }
        if (!known.includes(run.toLowerCase())) {
          return { ok: false, reason: `name not in the record: ${run}` };
        }
        index = end;
      } else {
        index += 1;
      }
    }
  }
  return { ok: true };
}
