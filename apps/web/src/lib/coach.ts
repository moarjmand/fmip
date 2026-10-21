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
