/**
 * API-Football's teams and venues (T-1438, D-229): `/teams?league=&season=`
 * lists every team of a competition's season with its founding year and its
 * home ground, and `/venues?id=` describes one ground. Only this file knows
 * their field names (rule 2).
 *
 * Read on 2026-10-21 from production's key: a team entry is
 * `{ team: { id, name, code, country, founded, national, logo }, venue: { id,
 * name, address, city, capacity, surface, image } }`; a venue entry is the
 * venue block with `country` and without the team. Addresses carry HTML
 * entities ("St. James&apos; Street"). No coordinates are sent.
 */

import type { NormalisedTeamFacts, NormalisedVenueFacts, VenueSurface } from '../../normalised';
import { decodeEntities } from '../../news/feed';
import { imageUrl, isRecord, type Json } from './map';

const rec = (value: unknown): Json => (isRecord(value) ? value : {});
const int = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;
const id = (value: unknown): string | null => {
  const n = int(value);
  // Positive only (T-1600): the provider writes 0 for "not known", and as an
  // id it made one person, coach or venue of every unknown one (rule 1).
  return n === null || n <= 0 ? null : String(n);
};

/** Text as the provider wrote it, made plain: entities decoded, whitespace collapsed; `null` when blank. */
function plain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/**
 * The provider's surface words as ours. Seen: "grass", "artificial turf"
 * (either case); "hybrid" is named for the stitched pitches some grounds
 * list. Anything else is `null`, never a guess.
 */
export function venueSurface(value: unknown): VenueSurface | null {
  const text = plain(value)?.toLowerCase() ?? null;
  if (text === null) return null;
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\b(artificial|synthetic|astro)/.test(text)) return 'artificial';
  if (/^(natural )?grass$/.test(text)) return 'grass';
  return null;
}

/** A capacity is a whole number of seats above zero; the provider's 0 means it does not know. */
function capacity(value: unknown): number | null {
  const n = int(value);
  return n !== null && n > 0 && n <= 1_000_000 ? n : null;
}

/** A founding year from 1800 to 2100 (the schema's range), else `null`. */
function foundedYear(value: unknown): number | null {
  const n = int(value);
  return n !== null && n >= 1800 && n <= 2100 ? n : null;
}

/** One venue block, or `null` without an id and a name. */
export function venueFacts(value: unknown): NormalisedVenueFacts | null {
  const v = rec(value);
  const externalId = id(v.id);
  const name = plain(v.name);
  if (externalId === null || name === null) return null;
  return {
    externalId,
    name,
    city: plain(v.city),
    address: plain(v.address),
    capacity: capacity(v.capacity),
    surface: venueSurface(v.surface),
    imageUrl: imageUrl(v.image),
  };
}

/** `/teams?league=&season=` → one entry per team; an entry without a team id and name is skipped, a team listed twice counts once. */
export function mapTeamFacts(response: unknown): NormalisedTeamFacts[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedTeamFacts[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const it = rec(item);
    const team = rec(it.team);
    const externalId = id(team.id);
    const name = plain(team.name);
    if (externalId === null || name === null || seen.has(externalId)) continue;
    seen.add(externalId);
    const logo = imageUrl(team.logo);
    out.push({
      team: logo === null ? { externalId, name } : { externalId, name, imageUrl: logo },
      national: typeof team.national === 'boolean' ? team.national : null,
      foundedYear: foundedYear(team.founded),
      venue: venueFacts(it.venue),
    });
  }
  return out;
}

/** `/venues?id=` → the venue asked about, or `null` when the answer holds no entry for it. */
export function mapVenue(response: unknown, venueExternalId: string): NormalisedVenueFacts | null {
  if (!Array.isArray(response)) return null;
  for (const item of response) {
    const venue = venueFacts(item);
    if (venue !== null && venue.externalId === venueExternalId) return venue;
  }
  return null;
}
