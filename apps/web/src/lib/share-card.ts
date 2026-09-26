import type { CompetitionPage, ForecastVersion, MatchHeader, TableRow } from '@fmip/contracts';
import { percentages } from './forecast';

/**
 * The words on a share card (T-520): the picture a chat app shows when a link
 * to a match or a table is pasted into it.
 *
 * A card is read by people who have not opened the page, so it may not say
 * anything the page does not: it is built from the same answer the page is
 * built from, and when that answer is missing it says only the product's
 * name. It is the same for every reader -- a chat preview is fetched once and
 * shown to everyone in the chat -- so a time is written in UTC and says so,
 * never in a zone the card cannot know. Pure, so every rule is tested without
 * rendering a picture.
 */

export const CARD_SIZE = { width: 1200, height: 630 } as const;

export interface MatchCardText {
  /** Competition, season, and the round when there is one. */
  eyebrow: string;
  home: string;
  away: string;
  /** The score, or "v" before a ball is kicked. */
  centre: string;
  /** Full time, live with the minute, the kick-off in UTC, or what happened instead. */
  status: string;
  /**
   * The statistical model's three probabilities, when the page shows them;
   * labelled as the model's, never as a prediction by a person (rule 6).
   */
  forecast: { line: string; source: string } | null;
}

const STATUS_WORDS: Partial<Record<MatchHeader['status'], string>> = {
  finished: 'Full time',
  postponed: 'Postponed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
  awarded: 'Awarded',
};

/** "Sat 4 Oct 2026 · 14:00 UTC". */
export function kickoffUtc(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(at);
  return `${day.replace(',', '')} · ${time} UTC`;
}

export function matchCardText(header: MatchHeader, latest: ForecastVersion | null): MatchCardText {
  const score = header.scores.current ?? header.scores.full_time;
  const started = header.status !== 'scheduled' && header.status !== 'postponed';
  const status =
    header.status === 'live'
      ? header.minute === null
        ? 'Live'
        : `Live ${header.minute}′`
      : header.status === 'scheduled'
        ? kickoffUtc(header.kickoff_at)
        : (STATUS_WORDS[header.status] ?? header.status);

  let forecast: MatchCardText['forecast'] = null;
  if (latest !== null && latest.status === 'available' && latest.probabilities !== null) {
    const p = percentages(latest.probabilities);
    forecast = {
      line: `${header.home.name} ${p.home}% · Draw ${p.draw}% · ${header.away.name} ${p.away}%`,
      source: `The statistical model’s forecast (${latest.model_version})`,
    };
  }

  return {
    eyebrow: [header.competition.name, header.season.label, header.round]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    home: header.home.name,
    away: header.away.name,
    centre: started && score !== null ? `${score.home} – ${score.away}` : 'v',
    status,
    forecast,
  };
}

/**
 * The type size for a team's name on the match card: full size for most, and
 * smaller for a long one so that two lines of it still sit beside the score
 * (seen on the server: "Omonia Nicosia", "Gençlerbirliği S.K.").
 */
export function nameSize(name: string): number {
  if (name.length <= 12) return 58;
  if (name.length <= 18) return 50;
  return 42;
}

export interface TableCardRow extends Pick<TableRow, 'position' | 'played' | 'points'> {
  team: string;
}

export interface TableCardText {
  title: string;
  season: string;
  /** The top of the table, as many rows as fit; empty when the page has none. */
  rows: TableCardRow[];
  /** Why there are no rows, in the page's own words, or `null` when there are. */
  absence: string | null;
}

/** How many rows of a table fit on a card and stay legible in a chat preview. */
export const TABLE_CARD_ROWS = 6;

export function tableCardText(page: CompetitionPage): TableCardText {
  const rows = page.table.data ?? [];
  return {
    title: page.competition.name,
    season: page.season.label,
    rows: rows.slice(0, TABLE_CARD_ROWS).map((row) => ({
      position: row.position,
      team: row.team.name,
      played: row.played,
      points: row.points,
    })),
    absence: rows.length === 0 ? 'No table for this season yet.' : null,
  };
}
