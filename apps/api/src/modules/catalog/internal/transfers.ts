import {
  type CoverageState,
  type PlayerTransfers,
  type TeamTransfers,
  type TransferClub,
  type TransferKind,
  type TransferLine,
} from '@fmip/contracts';
import { transfersRefreshDays } from '@fmip/ingestion';
import type { Pool } from 'pg';

/**
 * A club's and a player's transfers (T-1440, D-231), read from what the
 * `transfers` job stored. Reads only. A player or club we hold is named as our
 * catalogue names it, in the reader's language where we have it, and carries
 * its id; one we do not hold is the provider's name alone, with no id.
 */

/** The name a reader is shown for each source the job writes. */
const SOURCE_NAMES: Record<string, string> = { api_football: 'API-Football' };
const SOURCE = 'api_football';
const DAY_MS = 24 * 60 * 60 * 1000;
/** How many arrivals and departures a club's section lists, newest first. */
export const TEAM_TRANSFERS_SHOWN = 25;

/**
 * The state of an answer: nothing before the first, nothing when it listed no
 * move, `delayed` once it is older than twice the job's refresh (the job is
 * behind), else `available`. Pure.
 */
export function transfersCoverage(
  answeredAt: Date | null,
  moves: number,
  now: Date,
): CoverageState {
  if (answeredAt === null || moves === 0) return 'not_supplied';
  const behind = now.getTime() - answeredAt.getTime() > 2 * transfersRefreshDays(now) * DAY_MS;
  return behind ? 'delayed' : 'available';
}

interface Row {
  id: string;
  date: string;
  kind: TransferKind;
  fee: string | null;
  person_id: string | null;
  person_name: string;
  from_team_id: string | null;
  from_name: string | null;
  to_team_id: string | null;
  to_name: string | null;
}

/** Our names for the player and the clubs we hold, the provider's for the rest. */
const LINES = `
  SELECT l.id::text, l.transfer_date::text AS date, l.kind, l.fee, p.id AS person_id,
         coalesce(localised_name('person', p.id, $3), p.known_as, p.full_name, l.person_name)
           AS person_name,
         ft.id AS from_team_id,
         CASE WHEN ft.id IS NULL THEN l.from_name
              ELSE coalesce(localised_name('team', ft.id, $3), ft.short_name, ft.name) END
           AS from_name,
         tt.id AS to_team_id,
         CASE WHEN tt.id IS NULL THEN l.to_name
              ELSE coalesce(localised_name('team', tt.id, $3), tt.short_name, tt.name) END
           AS to_name
    FROM transfer_listing l
    LEFT JOIN person p ON p.id = l.person_id
    LEFT JOIN team ft ON ft.id = l.from_team_id
    LEFT JOIN team tt ON tt.id = l.to_team_id`;

function club(id: string | null, name: string | null): TransferClub | null {
  if (name === null) return null;
  return id === null ? { id: null, name } : { id, name };
}

function line(r: Row): TransferLine {
  return {
    date: r.date,
    kind: r.kind,
    fee: r.fee,
    player:
      r.person_id === null
        ? { id: null, name: r.person_name }
        : { id: r.person_id, name: r.person_name },
    from: club(r.from_team_id, r.from_name),
    to: club(r.to_team_id, r.to_name),
  };
}

export async function readTeamTransfers(
  pool: Pool,
  teamId: string,
  locale: string | null,
  now: Date = new Date(),
): Promise<TeamTransfers> {
  const source_name = SOURCE_NAMES[SOURCE] ?? SOURCE;
  const fetch = await pool.query<{ answered_at: Date }>(
    `SELECT answered_at FROM team_transfer_fetch
      WHERE team_id = $1 AND provider = $2 AND answered_at IS NOT NULL`,
    [teamId, SOURCE],
  );
  const answeredAt = fetch.rows[0]?.answered_at ?? null;
  if (answeredAt === null) {
    return {
      source_name,
      transfers: { coverage: 'not_supplied', last_updated_at: null, data: null },
    };
  }
  const { rows } = await pool.query<Row>(
    `${LINES}
      WHERE l.subject_team_id = $1 AND l.source = $2
      ORDER BY l.transfer_date DESC, l.id`,
    [teamId, SOURCE, locale],
  );
  const arrivals = rows.filter((r) => r.to_team_id === teamId).map(line);
  const departures = rows.filter((r) => r.from_team_id === teamId).map(line);
  const moves = arrivals.length + departures.length;
  const coverage = transfersCoverage(answeredAt, moves, now);
  return {
    source_name,
    transfers: {
      coverage,
      last_updated_at: answeredAt.toISOString(),
      data:
        coverage === 'not_supplied'
          ? null
          : {
              arrivals: arrivals.slice(0, TEAM_TRANSFERS_SHOWN),
              departures: departures.slice(0, TEAM_TRANSFERS_SHOWN),
              arrivals_total: arrivals.length,
              departures_total: departures.length,
            },
    },
  };
}

/** A side as a key for counting one move once across two clubs' answers. Pure. */
function sideKey(id: string | null, name: string | null): string {
  if (name === null) return '-';
  return id === null ? `name:${name.toLowerCase()}` : `id:${id}`;
}

/**
 * The same move listed in both clubs' answers, counted once (the first,
 * which is the newest stored). Pure.
 */
export function oncePerMove<T extends Row>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.date}|${sideKey(r.from_team_id, r.from_name)}|${sideKey(r.to_team_id, r.to_name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function readPlayerTransfers(
  pool: Pool,
  personId: string,
  locale: string | null,
  now: Date = new Date(),
): Promise<PlayerTransfers> {
  const source_name = SOURCE_NAMES[SOURCE] ?? SOURCE;
  const fetch = await pool.query<{ answered_at: Date }>(
    `SELECT answered_at FROM person_transfer_fetch
      WHERE person_id = $1 AND provider = $2 AND answered_at IS NOT NULL`,
    [personId, SOURCE],
  );
  const answeredAt = fetch.rows[0]?.answered_at ?? null;
  if (answeredAt !== null) {
    // The provider's own list for this player: every move it knows.
    const { rows } = await pool.query<Row>(
      `${LINES}
        WHERE l.subject_person_id = $1 AND l.source = $2
        ORDER BY l.transfer_date DESC, l.id`,
      [personId, SOURCE, locale],
    );
    const coverage = transfersCoverage(answeredAt, rows.length, now);
    return {
      source_name,
      transfers: {
        coverage,
        last_updated_at: answeredAt.toISOString(),
        data: coverage === 'not_supplied' ? null : { lines: rows.map(line) },
      },
    };
  }
  // Not asked about yet: the moves the answers about our clubs list for him,
  // which leave out any between clubs we do not hold.
  const { rows } = await pool.query<Row & { fetched_at: Date }>(
    `${LINES.replace('SELECT l.id::text,', 'SELECT l.id::text, l.fetched_at,')}
      WHERE l.person_id = $1 AND l.source = $2 AND l.subject_team_id IS NOT NULL
      ORDER BY l.transfer_date DESC, l.fetched_at DESC, l.id`,
    [personId, SOURCE, locale],
  );
  const once = oncePerMove(rows);
  if (once.length === 0) {
    return {
      source_name,
      transfers: { coverage: 'not_supplied', last_updated_at: null, data: null },
    };
  }
  const latest = rows.reduce((a, r) => (r.fetched_at > a ? r.fetched_at : a), rows[0]!.fetched_at);
  return {
    source_name,
    transfers: {
      coverage: 'limited',
      last_updated_at: latest.toISOString(),
      data: { lines: once.map(line) },
    },
  };
}
