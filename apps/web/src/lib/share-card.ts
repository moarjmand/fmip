import type {
  CompetitionPage,
  ForecastVersion,
  MatchHeader,
  PredictionHistoryItem,
  PublicProfile,
  Rating,
  TableRow,
} from '@fmip/contracts';
import { percentages } from './forecast';
import { OUTCOME_LABEL } from './prediction-form';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';

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

/**
 * The words **on** a card stay English, for every reader (T-1309). `next/og`'s
 * renderer (Satori) joins Persian and Arabic letters but lays the words of a
 * right-to-left line out left to right, ignores `direction: rtl`, and draws a
 * zero-width non-joiner as a visible box -- checked by rendering a Persian
 * line with it. A card that reads backwards would be worse than one in
 * English. What the card is *described* as -- its `og:image:alt`, which a
 * chat app and a screen reader read as text -- is in the reader's language.
 */
const ALT_KEY = {
  match: 'shared.og.matchAlt',
  competition: 'shared.og.competitionAlt',
  member: 'shared.og.memberAlt',
} as const satisfies Record<string, MessageKey>;

/**
 * A card route's `generateImageMetadata`: one image, its alt text in the
 * reader's language. `params` is read whether Next.js hands it over as an
 * object or as a promise.
 */
export async function cardImageMetadata(
  kind: keyof typeof ALT_KEY,
  params: { locale: string } | Promise<{ locale: string }>,
): Promise<{ id: string; alt: string; size: typeof CARD_SIZE; contentType: string }[]> {
  const { locale } = await params;
  return [
    {
      id: 'card',
      alt: t(isLocale(locale) ? locale : DEFAULT_LOCALE, ALT_KEY[kind]),
      size: CARD_SIZE,
      contentType: 'image/png',
    },
  ];
}

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

export interface MemberCardText {
  name: string;
  handle: string;
  /** The rating as the profile shows it, or a sentence when there is none yet. */
  rating: string;
  /** The latest settled predictions, newest first, as many as fit. */
  recent: { match: string; verdict: string }[];
}

/** How many settled predictions fit on a member's card. */
export const MEMBER_CARD_PREDICTIONS = 3;

/**
 * A member's card, from their profile as a signed-out visitor sees it. The
 * route asks for that view without a session, so a friends-only or private
 * profile never reaches this function and has no card beyond the product's
 * name; a member whose history is hidden shows their rating and nothing else.
 */
export function memberCardText(
  profile: Pick<PublicProfile, 'display_name' | 'username'>,
  rating: Rating | null,
  history: PredictionHistoryItem[],
): MemberCardText {
  const status = rating === null ? '' : rating.established ? ' · established' : ' · provisional';
  return {
    name: profile.display_name,
    handle: `@${profile.username}`,
    rating:
      rating === null
        ? 'No settled predictions yet'
        : `Rating ${rating.rating.toFixed(1)}${status} · ${rating.settled_count} settled`,
    recent: history
      .filter((item) => item.prediction.settlement?.status === 'settled')
      .slice(0, MEMBER_CARD_PREDICTIONS)
      .map(({ fixture, prediction }) => {
        const actual = prediction.settlement?.actual ?? fixture.score;
        const score = actual === null ? 'v' : `${actual.home}–${actual.away}`;
        const right = prediction.settlement?.outcome_correct === true;
        return {
          match: `${fixture.home.name} ${score} ${fixture.away.name}`,
          verdict: `${OUTCOME_LABEL[prediction.latest.outcome]} · ${right ? 'right' : 'wrong'}`,
        };
      }),
  };
}
