/**
 * API-Football `/coachs?team=` → the normalised model (T-1439, D-230), and
 * the coach id space.
 *
 * API-Football numbers coaches apart from players: coach 4 is Guardiola,
 * player 4 a goalkeeper (`_fixtures/api-football-coachs/coachs-id-4.json`).
 * Both are people to us, mapped as `person` in `provider_mapping`, so a coach's
 * number is written `coach:4` everywhere this adapter names a coach -- the
 * line-ups' `coach` block (`map.ts`) and the coaches endpoint alike -- and one number
 * never names two people (rule 1). A player keeps his bare number.
 *
 * Field names below are API-Football's (including its spelling, `coachs`).
 * None of them leave this directory.
 */

import type { EntityRef, NormalisedCoach, NormalisedCoachSpell } from '../../normalised';
import {
  COACH_ID_PREFIX,
  calendarDate,
  imageUrl,
  isRecord,
  nationality,
  plainName,
  type Json,
} from './map';

export { COACH_ID_PREFIX };

const rec = (value: unknown): Json => (isRecord(value) ? value : {});

/** A provider id: a positive whole number, as a string. */
const number = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : null;

/** The coach's external id for the provider's coach number, or `null` without one. */
export function coachExternalId(value: unknown): string | null {
  const n = number(value);
  return n === null ? null : `${COACH_ID_PREFIX}${n}`;
}

/** The provider's coach number inside an external id (`coach:4` → `4`), or `null` for anything else. */
export function coachNumber(externalId: string): string | null {
  if (!externalId.startsWith(COACH_ID_PREFIX)) return null;
  const n = externalId.slice(COACH_ID_PREFIX.length);
  return /^[1-9]\d*$/.test(n) ? n : null;
}

/**
 * A coach block (`{ id, name, photo }`, in a line-up or the coaches
 * endpoint) as a ref in the coach id space, with the photo when it carries
 * one; `null` without an id or a name.
 */
export function coachRef(value: unknown): EntityRef | null {
  const v = rec(value);
  const externalId = coachExternalId(v.id);
  const name = plainName(v.name);
  if (externalId === null || name === null) return null;
  const photo = imageUrl(v.photo);
  return photo === null ? { externalId, name } : { externalId, name, imageUrl: photo };
}

function teamRef(value: unknown): EntityRef | null {
  const v = rec(value);
  const externalId = number(v.id);
  const name = plainName(v.name);
  if (externalId === null || name === null) return null;
  const logo = imageUrl(v.logo);
  return logo === null ? { externalId, name } : { externalId, name, imageUrl: logo };
}

/**
 * One career entry. Dropped without a team, and when it ends before it
 * starts: such an entry cannot be read, and keeping half of it would invent
 * an open spell.
 */
function spell(value: unknown): NormalisedCoachSpell | null {
  const v = rec(value);
  const team = teamRef(v.team);
  if (team === null) return null;
  const start = calendarDate(v.start);
  const end = calendarDate(v.end);
  if (start !== null && end !== null && end < start) return null;
  return { team, start, end };
}

/** Newest first: by start, a spell without one last; a spell the answer lists twice once. */
function career(value: unknown): NormalisedCoachSpell[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NormalisedCoachSpell[] = [];
  for (const entry of value) {
    const s = spell(entry);
    if (s === null) continue;
    const key = `${s.team.externalId}|${s.start ?? ''}|${s.end ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) =>
    a.start === b.start
      ? 0
      : a.start === null
        ? 1
        : b.start === null
          ? -1
          : a.start < b.start
            ? 1
            : -1,
  );
}

/**
 * `/coachs?team=` (or `?id=`): one entry per coach with `id`, `name` (often
 * the short form, "E. Maresca", sometimes a surname alone, "Guardiola"),
 * `firstname`, `lastname`, `birth.date`, `nationality`, `photo` and `career`
 * (`team`, `start`, `end`). The current `team` the entry also carries is not
 * read: it is the provider's own reading of the career, and it can be stale.
 * An entry without an id or a name is dropped; a coach listed twice is kept
 * once.
 */
export function mapCoaches(response: unknown): NormalisedCoach[] {
  if (!Array.isArray(response)) return [];
  const seen = new Set<string>();
  const out: NormalisedCoach[] = [];
  for (const item of response) {
    const ref = coachRef(item);
    if (ref === null || seen.has(ref.externalId)) continue;
    seen.add(ref.externalId);
    const it = rec(item);
    const givenName = plainName(it.firstname);
    const familyName = plainName(it.lastname);
    out.push({
      ref,
      name:
        givenName === null || familyName === null
          ? null
          : { fullName: `${givenName} ${familyName}`, givenName, familyName },
      dateOfBirth: calendarDate(rec(it.birth).date),
      nationality: nationality(it.nationality),
      career: career(it.career),
    });
  }
  return out;
}
