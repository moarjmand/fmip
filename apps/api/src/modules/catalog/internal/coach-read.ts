import type { Pool } from 'pg';
import type {
  CoachCareerSpell,
  CoachCareerTeam,
  CoachPage,
  Covered,
  TeamHeadCoach,
} from '@fmip/contracts';

/**
 * The coaches' read side (T-1439, D-230): the coach page and the team page's
 * head coach, from `coach_spell` (the provider's careers at the teams we
 * carry), `coach_fetch`, `team_coach_fetch` and the line-ups' coach
 * references. Names are ours (`localised_name`), never the provider's.
 */

/** An open spell at one team: whose, and when it started. */
export interface OpenSpell {
  personId: string;
  /** ISO calendar date; null when the provider gave none. */
  start: string | null;
}

/**
 * The team's current coach among the open spells the provider lists at it:
 * the one that started last. A spell without a start counts only when it is
 * the only open one -- it cannot be ordered against another. Two coaches
 * whose open spells start on the same latest day are no answer: which one is
 * current cannot be read, and neither is guessed. Pure.
 */
export function currentOpenSpell(spells: OpenSpell[]): OpenSpell | null {
  const byPerson = new Map<string, OpenSpell>();
  for (const s of spells) {
    const held = byPerson.get(s.personId);
    // One coach with two open spells at the team: the later one is his.
    if (held === undefined || (s.start !== null && (held.start === null || s.start > held.start))) {
      byPerson.set(s.personId, s);
    }
  }
  const open = [...byPerson.values()];
  if (open.length === 1) return open[0]!;
  const dated = open.filter((s) => s.start !== null);
  if (dated.length === 0) return null;
  const latest = dated.reduce((a, b) => (b.start! > a.start! ? b : a));
  return dated.filter((s) => s.start === latest.start).length === 1 ? latest : null;
}

const NOT_SUPPLIED = { coverage: 'not_supplied', last_updated_at: null, data: null } as const;

/**
 * The team's head coach (see `TeamHeadCoach`), without the photo, which the
 * caller adds from its media index. `not_supplied` until the team's coaches
 * were answered, or when the answer names no current coach we hold.
 */
export async function readTeamHeadCoach(
  pool: Pool,
  teamId: string,
  locale: string | null,
  lineupCoachId: string | null,
): Promise<Covered<Omit<TeamHeadCoach, 'person'> & { person: { id: string; name: string } }>> {
  const { rows: answered } = await pool.query<{ answered_at: Date }>(
    `SELECT answered_at FROM team_coach_fetch WHERE team_id = $1 AND answered_at IS NOT NULL
      ORDER BY answered_at DESC LIMIT 1`,
    [teamId],
  );
  const answeredAt = answered[0]?.answered_at;
  if (answeredAt === undefined) return NOT_SUPPLIED;
  const { rows } = await pool.query<{
    person_id: string;
    start_date: string | null;
    name: string;
  }>(
    `SELECT cs.person_id, cs.start_date::text,
            coalesce(localised_name('person', p.id, $2), p.known_as, p.full_name) AS name
       FROM coach_spell cs
       JOIN person p ON p.id = cs.person_id
      WHERE cs.team_id = $1 AND cs.end_date IS NULL`,
    [teamId, locale],
  );
  const current = currentOpenSpell(
    rows.map((r) => ({ personId: r.person_id, start: r.start_date })),
  );
  const row = current === null ? undefined : rows.find((r) => r.person_id === current.personId);
  if (current === null || row === undefined) {
    return { coverage: 'not_supplied', last_updated_at: answeredAt.toISOString(), data: null };
  }
  return {
    coverage: 'available',
    last_updated_at: answeredAt.toISOString(),
    data: {
      person: { id: row.person_id, name: row.name },
      since: current.start,
      lineup_disagrees: lineupCoachId !== null && lineupCoachId !== row.person_id,
    },
  };
}

/** A career spell before its crest is added. */
export type CoachCareerRow = Omit<CoachCareerSpell, 'team'> & {
  team: Omit<CoachCareerTeam, 'crest'>;
};

/** The coach page without photos and crests, which the caller adds. */
export interface CoachPageRows extends Omit<CoachPage, 'coach' | 'career'> {
  coach: Omit<CoachPage['coach'], 'photo'>;
  career: Covered<CoachCareerRow[]>;
}

/** The coach page's rows; `null` for no such coach. */
export async function readCoachPage(
  pool: Pool,
  id: string,
  locale: string | null,
): Promise<CoachPageRows | null> {
  const { rows: people } = await pool.query<{
    id: string;
    name: string;
    date_of_birth: string | null;
    nationality_id: string | null;
    nationality_name: string | null;
    fetched_at: Date | null;
    spells_unmapped: number | null;
    lineups: number;
  }>(
    `SELECT p.id, coalesce(localised_name('person', p.id, $2), p.known_as, p.full_name) AS name,
            p.date_of_birth::text, co.id AS nationality_id, co.name AS nationality_name,
            cf.fetched_at, cf.spells_unmapped,
            (SELECT count(*)::int FROM fixture_participant fp WHERE fp.coach_id = p.id) AS lineups
       FROM person p
       LEFT JOIN country co ON co.id = p.nationality_id
       LEFT JOIN LATERAL (
         SELECT fetched_at, spells_unmapped FROM coach_fetch
          WHERE person_id = p.id ORDER BY fetched_at DESC LIMIT 1) cf ON true
      WHERE p.id = $1`,
    [id, locale],
  );
  const person = people[0];
  // A person is a coach when the provider described him as one or a line-up named him so.
  if (person === undefined || (person.fetched_at === null && person.lineups === 0)) return null;

  const { rows: spells } = await pool.query<{
    team_id: string;
    team_name: string;
    short_name: string | null;
    kind: 'club' | 'national';
    start_date: string | null;
    end_date: string | null;
    team_answered: boolean;
  }>(
    `SELECT t.id AS team_id, coalesce(localised_name('team', t.id, $2), t.name) AS team_name,
            t.short_name, t.kind, cs.start_date::text, cs.end_date::text,
            EXISTS (SELECT 1 FROM team_coach_fetch tf
                     WHERE tf.team_id = t.id AND tf.answered_at IS NOT NULL) AS team_answered
       FROM coach_spell cs
       JOIN team t ON t.id = cs.team_id
      WHERE cs.person_id = $1
      ORDER BY cs.start_date DESC NULLS LAST, cs.end_date DESC NULLS FIRST, t.name`,
    [id, locale],
  );
  const openTeams = [
    ...new Set(spells.filter((s) => s.end_date === null && s.team_answered).map((s) => s.team_id)),
  ];
  const { rows: open } = await pool.query<{
    team_id: string;
    person_id: string;
    start_date: string | null;
  }>(
    `SELECT team_id, person_id, start_date::text FROM coach_spell
      WHERE end_date IS NULL AND team_id = ANY($1::uuid[])`,
    [openTeams],
  );
  const currentAt = new Map<string, OpenSpell | null>();
  for (const teamId of openTeams) {
    currentAt.set(
      teamId,
      currentOpenSpell(
        open
          .filter((o) => o.team_id === teamId)
          .map((o) => ({ personId: o.person_id, start: o.start_date })),
      ),
    );
  }

  const { rows: latest } = await pool.query<{
    fixture_id: string;
    kickoff_at: Date;
    team_id: string;
    team_name: string;
  }>(
    `SELECT f.id AS fixture_id, f.kickoff_at, t.id AS team_id,
            coalesce(localised_name('team', t.id, $2), t.name) AS team_name
       FROM fixture_participant fp
       JOIN fixture f ON f.id = fp.fixture_id
       JOIN team t ON t.id = fp.team_id
      WHERE fp.coach_id = $1
      ORDER BY f.kickoff_at DESC
      LIMIT 1`,
    [id, locale],
  );
  const last = latest[0];

  const fetchedAt = person.fetched_at?.toISOString() ?? null;
  const unmapped = person.spells_unmapped ?? 0;
  return {
    coach: {
      id: person.id,
      name: person.name,
      date_of_birth: person.date_of_birth,
      nationality:
        person.nationality_id !== null && person.nationality_name !== null
          ? { id: person.nationality_id, name: person.nationality_name }
          : null,
    },
    career:
      fetchedAt === null
        ? NOT_SUPPLIED
        : {
            coverage: unmapped > 0 ? 'limited' : 'available',
            last_updated_at: fetchedAt,
            data: spells.map((s) => {
              const current = currentAt.get(s.team_id);
              return {
                team: { id: s.team_id, name: s.team_name, short_name: s.short_name, kind: s.kind },
                start_date: s.start_date,
                end_date: s.end_date,
                current:
                  s.end_date === null &&
                  current != null &&
                  current.personId === id &&
                  current.start === s.start_date,
              };
            }),
          },
    spells_not_carried: unmapped,
    lineups: {
      count: person.lineups,
      latest:
        last === undefined
          ? null
          : {
              fixture_id: last.fixture_id,
              kickoff_at: last.kickoff_at.toISOString(),
              team: { id: last.team_id, name: last.team_name },
            },
    },
    last_updated_at: fetchedAt,
  };
}
