import type { CoachCareerSpell, CoachPage } from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import { say } from '@/lib/competition';

/**
 * The coach page's rules (T-1439, D-230), apart from the markup so they can be
 * argued with in a unit test.
 */

/** "Aug 2026", in the reader's language, from an ISO calendar date. */
function month(locale: string, iso: string): string {
  return formatDate(locale, `${iso}T00:00:00Z`, 'UTC', { month: 'short', year: 'numeric' });
}

/**
 * A spell's period as the provider gave it: an open spell that is current
 * runs to "present"; an open one that is not says its end was not given --
 * never "present", which would claim a job the coach may have left -- and a
 * missing start says so too.
 */
export function coachSpellPeriod(
  locale: string,
  spell: Pick<CoachCareerSpell, 'start_date' | 'end_date' | 'current'>,
): string {
  const start =
    spell.start_date === null
      ? say(locale, 'coachPage.startNotGiven')
      : month(locale, spell.start_date);
  const end =
    spell.end_date !== null
      ? month(locale, spell.end_date)
      : spell.current
        ? say(locale, 'coachPage.present')
        : say(locale, 'coachPage.endNotGiven');
  return `${start} – ${end}`;
}

/** The spells that make him a team's current coach, newest first. */
export function currentSpells(page: CoachPage): CoachCareerSpell[] {
  return (page.career.data ?? []).filter((s) => s.current);
}

/**
 * How old the coaching record may be before "Coaching now" and "Current"
 * stop reading as today's (T-1807, D-406; rule 4). The maintainer's figure:
 * seven days.
 */
export const COACH_RECORD_STALE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many whole days ago the coaching record was updated, when that is more
 * than `COACH_RECORD_STALE_DAYS`; `null` while it is fresh, or when no time
 * was given (the page then says "not supplied" by its coverage, not a guess).
 */
export function staleRecordDays(lastUpdatedAt: string | null, now: Date): number | null {
  if (lastUpdatedAt === null) return null;
  const then = Date.parse(lastUpdatedAt);
  if (Number.isNaN(then)) return null;
  const days = Math.floor((now.getTime() - then) / DAY_MS);
  return days > COACH_RECORD_STALE_DAYS ? days : null;
}
