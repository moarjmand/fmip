import type {
  CompetitionDirectoryEntry,
  EntityMedia,
  ScoresGroup,
  ScoresResponse,
} from '@fmip/contracts';
import { formatDate, formatTime } from '@/i18n/format';
import { BAR_COMPETITIONS } from '@/lib/competitions-directory';
import { dateIn } from '@/lib/scores';

/**
 * The matchday rail's rules (T-1624, D-292), pure so they are unit-tested
 * (`matchday-rail.spec.ts`); `components/matchday-rail.tsx` fetches and
 * draws. The rail is the one bar under the header: a chip per league with
 * its logo, its short name and one status, ordered by what is happening now,
 * and under it a drawer with the chosen league's matches today (what the
 * live strip of D-199 showed alone).
 *
 * Live and today come from today's scores answer in the reader's zone, the
 * one request the strip made; the next match day from the directory's
 * `next_kickoff_at` (T-1623).
 */

/**
 * A chip's one status: `live` (how many are being played), `later` (the
 * next kick-off today), `day` (the next match day after today, `days` ahead
 * by the reader's calendar) or `none` (nothing known: no status at all).
 */
export type RailStatus =
  | { kind: 'live'; count: number }
  | { kind: 'later'; at: string }
  | { kind: 'day'; at: string; days: number }
  | { kind: 'none' };

export interface RailLeague {
  id: string;
  name: string;
  short_name: string | null;
  /** Its logo from our own origin; `null` when no answer named one (the lettered mark). */
  logo: EntityMedia | null;
  /** Today's matches in kick-off order; `null` when it plays none today. */
  today: ScoresGroup | null;
  status: RailStatus;
}

/** Whole calendar days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A league's status. Live first: a league with a match being played says
 * how many. Then the next kick-off today among its matches yet to start.
 * Then its next match after today from the directory. A next kick-off that
 * falls today without a match in today's answer (the two answers are kept
 * apart for a few seconds) is still today's time. Nothing known, no status.
 */
export function railStatus(
  today: ScoresGroup | null,
  nextKickoff: string | null | undefined,
  now: number,
  timeZone: string,
): RailStatus {
  if (today !== null) {
    const live = today.fixtures.filter((card) => card.status === 'live').length;
    if (live > 0) return { kind: 'live', count: live };
    const later = today.fixtures
      .filter((card) => card.status === 'scheduled')
      .map((card) => card.kickoff_at)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    if (later !== undefined) return { kind: 'later', at: later };
  }
  const next = nextKickoff ?? null;
  const at = next === null ? Number.NaN : Date.parse(next);
  if (next === null || Number.isNaN(at) || at <= now) return { kind: 'none' };
  const days = daysBetween(dateIn(timeZone, new Date(now)), dateIn(timeZone, new Date(at)));
  return days <= 0 ? { kind: 'later', at: next } : { kind: 'day', at: next, days };
}

/** Which of the three bands a league is in: live, later today, the rest. */
function band(status: RailStatus): number {
  return status.kind === 'live' ? 0 : status.kind === 'later' ? 1 : 2;
}

/**
 * The rail's leagues, in order. Which: every league with a match today and
 * the first `size` of the product's order (the bar's, D-207). A league
 * playing today that the directory does not name (it could not be read) is
 * drawn from today's answer. The order: leagues with a match being played,
 * then those playing later today by their next kick-off, then the rest in
 * the product's order. Inside the first band, and for a tie, the product's
 * order holds.
 */
export function railLeagues(
  directory: readonly CompetitionDirectoryEntry[],
  scores: ScoresResponse | null,
  now: number,
  timeZone: string,
  size = BAR_COMPETITIONS,
): RailLeague[] {
  const groups = new Map<string, ScoresGroup>();
  for (const group of scores?.groups ?? []) {
    if (group.fixtures.length > 0 && !groups.has(group.competition.id)) {
      groups.set(group.competition.id, group);
    }
  }
  const chosen: RailLeague[] = [];
  directory.forEach((entry, index) => {
    const today = groups.get(entry.id) ?? null;
    if (today === null && index >= size) return;
    chosen.push({
      id: entry.id,
      name: entry.name,
      short_name: entry.short_name,
      logo: entry.logo,
      today,
      status: railStatus(today, entry.next_kickoff_at, now, timeZone),
    });
  });
  const named = new Set(chosen.map((league) => league.id));
  for (const group of groups.values()) {
    if (named.has(group.competition.id)) continue;
    chosen.push({
      id: group.competition.id,
      name: group.competition.name,
      short_name: group.competition.short_name,
      logo: group.competition.logo ?? null,
      today: group,
      status: railStatus(group, null, now, timeZone),
    });
  }
  const at = (status: RailStatus): number =>
    status.kind === 'later' ? Date.parse(status.at) : Number.POSITIVE_INFINITY;
  return chosen
    .map((league, index) => ({ league, index }))
    .sort(
      (a, b) =>
        band(a.league.status) - band(b.league.status) ||
        (band(a.league.status) === 1 ? at(a.league.status) - at(b.league.status) : 0) ||
        a.index - b.index,
    )
    .map(({ league }) => league);
}

/**
 * The drawer's matches in the order a reader looks for them: the ones being
 * played first, then those still to start, then the rest; kick-off order
 * inside each. A league marked "2 live" opens on its two live matches, not
 * on the ones that finished this afternoon.
 */
export function drawerFixtures<T extends { status: string; kickoff_at: string }>(
  fixtures: readonly T[],
): T[] {
  const rank = (card: T): number =>
    card.status === 'live' ? 0 : card.status === 'scheduled' ? 1 : 2;
  return [...fixtures].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at),
  );
}

/**
 * The league the drawer opens on: the first in the rail's order with a
 * match today, or none -- and then there is no drawer at all, never an
 * empty box that looks like a quiet day (rule 3).
 */
export function openLeague(leagues: readonly RailLeague[]): string | null {
  return leagues.find((league) => league.today !== null)?.id ?? null;
}

/**
 * A status in the reader's words, or `null` for none: "2 live" (`live`
 * gives the count's words), "20:00" in the reader's zone and digits, "Sat"
 * for a match day within six days, a short date ("2 Nov") beyond, with the
 * year when it is not this one by the reader's calendar.
 */
export function railStatusText(
  status: RailStatus,
  locale: string,
  timeZone: string,
  now: number,
  live: (count: number) => string,
): string | null {
  switch (status.kind) {
    case 'live':
      return live(status.count);
    case 'later':
      return formatTime(locale, status.at, timeZone);
    case 'day': {
      if (status.days <= 6) return formatDate(locale, status.at, timeZone, { weekday: 'short' });
      // The year by the locale's own calendar: on /fa the Persian one.
      const year = (iso: string) => formatDate(locale, iso, timeZone, { year: 'numeric' });
      const sameYear = year(new Date(now).toISOString()) === year(status.at);
      return formatDate(locale, status.at, timeZone, {
        day: 'numeric',
        month: 'short',
        ...(sameYear ? {} : { year: 'numeric' }),
      });
    }
    case 'none':
      return null;
  }
}
