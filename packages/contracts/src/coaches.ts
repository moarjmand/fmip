import type { Covered } from './coverage';
import type { EntityMedia } from './media';

/**
 * Coaches from the data provider's coaches endpoint (T-1439, D-230): a
 * coach is a person by our id, never by name (rule 1), and his career is the
 * provider's list of spells at the teams we carry.
 *
 * An open spell (no end date) is the provider's claim, and it leaves some
 * open after the coach has gone. A spell is `current` only when it is open
 * and no other coach the provider lists for that team has an open spell that
 * started later: the team's current coach is the latest open spell at it.
 */

/** A team in a coach's career. */
export interface CoachCareerTeam {
  id: string;
  name: string;
  short_name: string | null;
  kind: 'club' | 'national';
  crest: EntityMedia;
}

/** One spell, as the provider lists it. ISO 8601 calendar dates. */
export interface CoachCareerSpell {
  team: CoachCareerTeam;
  /** Null when the provider gave no start. */
  start_date: string | null;
  /** Null while open, or when the provider gave no end. */
  end_date: string | null;
  /** He is the team's current coach by this spell (see above). */
  current: boolean;
}

/** `GET /coaches/:id` (T-1439, D-230): the coach page. */
export interface CoachPage {
  coach: {
    id: string;
    name: string;
    photo: EntityMedia;
    /** ISO 8601 calendar date; null when no source supplied it. */
    date_of_birth: string | null;
    nationality: { id: string; name: string } | null;
  };
  /**
   * The career, newest first. `not_supplied` (data null) until the provider
   * was asked about any team he coached; `limited` when it listed spells at
   * teams we do not carry, which are counted in `spells_not_carried`, never
   * named.
   */
  career: Covered<CoachCareerSpell[]>;
  spells_not_carried: number;
  /**
   * The line-ups we hold that name him as their coach: how many, and the
   * latest, so the page can say where he was last seen on the bench.
   */
  lineups: {
    count: number;
    latest: {
      fixture_id: string;
      kickoff_at: string;
      team: { id: string; name: string };
    } | null;
  };
  last_updated_at: string | null;
}

/**
 * The team page's head coach (T-1439, D-230): the coach whose open spell at
 * the team started last, by the provider's coaches endpoint.
 * `TeamPage.head_coach` is `not_supplied` (data null) until the team's coaches
 * were asked, or when the answer named no current coach we hold yet.
 */
export interface TeamHeadCoach {
  person: { id: string; name: string; photo: EntityMedia };
  /** When the spell started; null when the provider gave no start. */
  since: string | null;
  /**
   * The latest stored line-up names another person as the coach (D-119's
   * manager): the provider's list may be behind a change, and the page says so.
   */
  lineup_disagrees: boolean;
}
