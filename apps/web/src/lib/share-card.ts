import type {
  CalledItCard,
  CompetitionPage,
  ForecastSummary,
  MatchHeader,
  PredictionHistoryItem,
  PublicProfile,
  Rating,
  TableRow,
  TeamPage,
  TeamPageFixture,
} from '@fmip/contracts';
import { percentages } from './forecast';
import { OUTCOME_LABEL } from './prediction-form';
import { stageLabel } from './stage-label';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, plural, t } from '@/i18n/messages';

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
 * English. Checked again with Vazirmatn, the site's own Persian face, on
 * 2026-11-13 (T-1825, D-419): its letters join, but the words still run
 * left to right and the parts a non-joiner separates are put in reverse. What the card is *described* as -- its `og:image:alt`, which a
 * chat app and a screen reader read as text -- is in the reader's language.
 */
const ALT_KEY = {
  match: 'shared.og.matchAlt',
  competition: 'shared.og.competitionAlt',
  member: 'shared.og.memberAlt',
  team: 'shared.og.teamAlt',
  brand: 'shared.og.brandAlt',
} as const satisfies Record<string, MessageKey>;

/** The alt text of a card in the reader's language (T-1309), for a route or a page's metadata. */
export function cardAlt(kind: keyof typeof ALT_KEY, locale: string): string {
  return t(isLocale(locale) ? locale : DEFAULT_LOCALE, ALT_KEY[kind]);
}

/**
 * The brand card's words (T-1825, D-419; B10 "Typographic wall"): the brand
 * line (`brand.line`, D-421), with the word that carries it -- "record" --
 * apart so the card can light it, and the strap under it. English on every
 * locale, as every card's words are (T-1309; the Persian spike of 2026-11-13
 * found the same right-to-left fault, see D-419).
 */
export const BRAND_CARD = {
  before: 'A forecast model that shows its',
  lit: 'record',
  after: 'in public.',
  strap: 'Live scores, match centres and forecasts',
} as const;

/**
 * The last segment of a card's address. The team card's ends in `.png`
 * (T-1826, D-420), so Cloudflare's edge, which caches by extension, keeps a
 * copy for the hour its `cache-control` allows instead of sending every
 * fetch to the origin. The match card keeps an extension-less address: it
 * still answers next/og's year-long header, which an edge must not hold for a
 * score that changes.
 */
const CARD_ID: Partial<Record<keyof typeof ALT_KEY, string>> = { team: 'card.png' };

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
      id: CARD_ID[kind] ?? 'card',
      alt: cardAlt(kind, locale),
      size: CARD_SIZE,
      contentType: 'image/png',
    },
  ];
}

/** What the model line needs of a forecast: a version or the pre-kick-off summary. */
export type CardForecast = Pick<ForecastSummary, 'status' | 'probabilities' | 'model_version'>;

export interface MatchCardText {
  /** Competition, season, and the round when there is one. */
  eyebrow: string;
  home: string;
  away: string;
  /** The score, or "v" before a ball is kicked (and for a match that never was). */
  centre: string;
  /**
   * The side that lost a finished match, whose name is drawn muted; `null`
   * for a draw and every other state.
   */
  loser: 'home' | 'away' | null;
  /** How a cup tie was decided, when the feed says so: "AET" or "Pens 4–3". */
  decided: string | null;
  /**
   * The recorded goals outnumber the reported result (T-1717, D-347): the score
   * is drawn muted, no side as the loser, and the status says it is unclear.
   */
  disputed: boolean;
  /**
   * Full time; live with the minute and when it was last heard from (a chat
   * keeps a preview for days, rule 4); the kick-off in UTC; or what happened
   * instead.
   */
  status: string;
  /**
   * The statistical model's line (rule 6: named as the model's, in its own
   * colour): its three probabilities from the version computed **before
   * kick-off**, or a sentence saying there is none. `null` -- no model line at
   * all -- for a match that will not be played as scheduled (postponed,
   * cancelled, abandoned, awarded, suspended) or that the feed has gone quiet
   * on (`awaiting_update`, D-343): a forecast beside it would read as current.
   */
  model: { line: string; source: string | null } | null;
}

const STATUS_WORDS: Partial<Record<MatchHeader['status'], string>> = {
  finished: 'Full time',
  postponed: 'Postponed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  abandoned: 'Abandoned',
  awarded: 'Awarded',
};

/** The states with no model line: the match is not being played as scheduled. */
const NO_MODEL_LINE: ReadonlySet<MatchHeader['status']> = new Set([
  'postponed',
  'suspended',
  'cancelled',
  'abandoned',
  'awarded',
]);

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
  return `${day.replace(',', '')} · ${clockUtc(iso)} UTC`;
}

/** "14:00", in UTC. */
function clockUtc(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** A name that fits a card: the short name for a very long one, when there is one. */
export function cardName(team: { name: string; short_name: string | null }): string {
  return team.name.length > 18 && team.short_name !== null && team.short_name !== ''
    ? team.short_name
    : team.name;
}

function liveStatus(header: MatchHeader): string {
  const minute =
    header.at_half_time === true
      ? 'Half time'
      : header.minute === null
        ? 'Live'
        : `Live ${header.minute}′`;
  const at = clockUtc(header.last_updated_at);
  return header.freshness === 'stale'
    ? `${minute} · no update since ${at} UTC`
    : `${minute} · as of ${at} UTC`;
}

function decidedBy(header: MatchHeader): string | null {
  const pens = header.scores.penalties;
  if (pens !== null) return `Pens ${pens.home}–${pens.away}`;
  return header.scores.extra_time !== null ? 'AET' : null;
}

/**
 * The match card's words (T-520; A10 "Matchday poster", T-1723). `preKickoff`
 * is the model's latest version computed before kick-off
 * (`GET /forecasts/pre-kickoff`), never a version computed during or after
 * the match (finding des-2026-11-02-01).
 */
export function matchCardText(header: MatchHeader, preKickoff: CardForecast | null): MatchCardText {
  const score = header.scores.current ?? header.scores.full_time;
  const awaiting = header.status === 'scheduled' && header.freshness === 'awaiting_update';
  const started = header.status !== 'scheduled' && header.status !== 'postponed';
  const status =
    header.status === 'live'
      ? liveStatus(header)
      : header.status === 'scheduled'
        ? // Never a kick-off time already long past (T-1713, D-343).
          awaiting
          ? 'Awaiting update'
          : kickoffUtc(header.kickoff_at)
        : (STATUS_WORDS[header.status] ?? header.status);

  const home = cardName(header.home);
  const away = cardName(header.away);
  let model: MatchCardText['model'] = null;
  if (!awaiting && !NO_MODEL_LINE.has(header.status)) {
    const before = header.status === 'scheduled' ? 'The model' : 'Before kick-off, the model';
    if (
      preKickoff !== null &&
      preKickoff.status === 'available' &&
      preKickoff.probabilities !== null
    ) {
      const p = percentages(preKickoff.probabilities);
      model = {
        line: `${before}: ${home} ${p.home}% · Draw ${p.draw}% · ${away} ${p.away}%`,
        source: preKickoff.model_version,
      };
    } else {
      model = {
        line:
          header.status === 'scheduled'
            ? 'The model’s forecast appears before kick-off'
            : 'The model published no forecast before kick-off',
        source: null,
      };
    }
  }

  const finished = header.status === 'finished' && score !== null;
  // T-1726: the card says what the match page says (D-347), never a final score in doubt.
  const disputed = finished && header.score_dispute != null;
  return {
    eyebrow: [header.competition.name, header.season.label, header.round]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    home,
    away,
    centre: started && score !== null ? `${score.home}–${score.away}` : 'v',
    loser:
      !finished || disputed
        ? null
        : score.home > score.away
          ? 'away'
          : score.home < score.away
            ? 'home'
            : null,
    decided: started && !disputed ? decidedBy(header) : null,
    disputed,
    status: disputed ? 'Score unclear in the source' : status,
    model,
  };
}

/**
 * The type size for a team's name on the match card: full size for most, and
 * smaller for a long one so that two lines of it still sit under its crest
 * (seen on the server: "Omonia Nicosia", "Gençlerbirliği S.K.").
 */
export function nameSize(name: string): number {
  if (name.length <= 12) return 44;
  if (name.length <= 18) return 38;
  return 32;
}

/** The match card's size, and the called-it card's; its story variant is tall. */
export const STORY_SIZE = { width: 1080, height: 1920 } as const;

export interface CalledItText {
  /** "PREMIER LEAGUE · REGULAR SEASON - 9 · SUN 1 NOV" (UTC), drawn in capitals. */
  eyebrow: string;
  home: string;
  away: string;
  /** The score the pick was settled against. */
  score: string;
  loser: 'home' | 'away' | null;
  /** "Exact score, too" when it was; otherwise null. */
  exact: string | null;
  /** "My pick: Arsenal to win", "My pick: Draw", "My pick: Arsenal 1–0". */
  pick: string;
  /** "Picked Fri 30 Oct · 17:34 UTC · 2 days before kick-off" (B17). */
  proof: string;
  handle: string;
}

/** "Sun 1 Nov", in UTC. */
function dayUtc(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(iso))
    .replace(',', '');
}

/** How long before kick-off a pick was made, in the largest whole unit. */
export function aheadOfKickoff(pickedAt: string, kickoffAt: string): string {
  const minutes = Math.floor((Date.parse(kickoffAt) - Date.parse(pickedAt)) / 60_000);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes >= 2 * 24 * 60)
    return `${plural(Math.floor(minutes / (24 * 60)), 'day')} before kick-off`;
  if (minutes >= 120) return `${plural(Math.floor(minutes / 60), 'hour')} before kick-off`;
  return `${plural(Math.max(minutes, 1), 'minute')} before kick-off`;
}

/**
 * The called-it card's words (B01 "The stamp" with B17's proof line, T-1723).
 * Only the member's own pick and the stored truth: no rating, no model, no
 * other member (rule 6), and none of a bookmaker's words ("won", "settled",
 * "odds"). The score is the one the pick was settled against.
 */
export function calledItText(card: CalledItCard): CalledItText {
  const home = cardName(card.home);
  const away = cardName(card.away);
  const { actual, pick } = card;
  const side = pick.outcome === 'home' ? home : pick.outcome === 'away' ? away : null;
  // A score is written from the side picked to win: "Arsenal 1–0", "Draw 1–1".
  const high = pick.score === null ? 0 : Math.max(pick.score.home, pick.score.away);
  const low = pick.score === null ? 0 : Math.min(pick.score.home, pick.score.away);
  const words =
    pick.score !== null
      ? `${side ?? 'Draw'} ${high}–${low}`
      : side === null
        ? 'Draw'
        : `${side} to win`;
  return {
    eyebrow: [card.competition, card.round, dayUtc(card.kickoff_at)]
      .filter((part): part is string => part !== null && part !== '')
      .join(' · '),
    home,
    away,
    score: `${actual.home}–${actual.away}`,
    loser: actual.home > actual.away ? 'away' : actual.home < actual.away ? 'home' : null,
    exact: card.exact && pick.score !== null ? 'Exact score, too' : null,
    pick: `My pick: ${words}`,
    proof: `Picked ${dayUtc(card.picked_at)} · ${clockUtc(card.picked_at)} UTC · ${aheadOfKickoff(card.picked_at, card.kickoff_at)}`,
    handle: `@${card.username}`,
  };
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

export interface TeamCardText {
  /** "England · Club · Founded 1886", as the club band's eyebrow. */
  eyebrow: string;
  name: string;
  /** The club's main competition (its domestic league first), or the sentence saying there is none. */
  competition: { name: string; known: boolean };
  /** "1st · 27 pts from 10" in that competition's table, or `null` with no table that places the club. */
  standing: string | null;
  /**
   * The next match and its day, or the sentence saying there is none, under
   * its label: "Next match", or "Now playing" / "Suspended" for the one in play
   * or suspended.
   */
  next: { label: string; match: string; detail: string | null; known: boolean };
  /** The day the card was drawn: a chat app keeps a picture for days (rule 4). */
  asOf: string;
}

/** The day in the UK, the English reader's zone: a date only, never a time (D-420). */
const CARD_DAY_ZONE = 'Europe/London';

function cardDay(at: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: CARD_DAY_ZONE })
    .format(at)
    .replace(',', '');
}

/**
 * The team card's words (T-1826, D-420; T1 "Club band"), from the club
 * page's own answer (`GET /teams/:id`, English names): the name, the club's
 * main competition -- the first, its domestic league where it has one, as
 * the club page's band reads it -- and where it stands there, the next match
 * and its day. What the answer does not hold is said, never made up (rule
 * 3): "No current competition on record", "No match scheduled". No forecast
 * is drawn: a kept picture of one would go stale (the spec, section 3).
 */
export function teamCardText(page: TeamPage, now: Date): TeamCardText {
  const team = page.team;
  const say = (key: MessageKey) => t(DEFAULT_LOCALE, key);
  const eyebrow = [
    ...(team.country !== null ? [team.country.name] : []),
    say(team.kind === 'national' ? 'teamPage.national' : 'teamPage.club'),
    ...(team.gender === 'women' ? [say('competitionPage.women')] : []),
    ...(team.founded_year !== null ? [`Founded ${team.founded_year}`] : []),
  ].join(' · ');

  const main = page.competitions[0] ?? null;
  // Only a table we hold in full and on time is drawn: a limited or delayed
  // one would be stamped with today's date as if it were current (rule 4).
  const table = main?.context.coverage === 'available' ? main.context.data : null;
  const own = table?.rows.find((row) => row.team.id === team.id) ?? null;
  const standing =
    table === null
      ? null
      : [
          plural(DEFAULT_LOCALE, 'team.position', table.position).text,
          own === null ? `${table.points} pts` : `${table.points} pts from ${own.played}`,
        ].join(' · ');

  const fixture = page.next_match;
  let next: TeamCardText['next'];
  if (fixture === null) {
    next = { label: 'Next match', match: 'No match scheduled', detail: null, known: false };
  } else {
    const round = fixture.round === null ? null : stageLabel(fixture.round, say, DEFAULT_LOCALE);
    const day =
      fixture.freshness === 'awaiting_update'
        ? 'Awaiting update'
        : cardDay(new Date(fixture.kickoff_at), {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          });
    next = {
      // `next_match` is the soonest still to play, which takes in a match in
      // play and a suspended one (`stillToPlay`): neither is "next".
      label:
        fixture.status === 'live'
          ? 'Now playing'
          : fixture.status === 'suspended'
            ? 'Suspended'
            : 'Next match',
      match: `${cardName(fixture.home)} v ${cardName(fixture.away)}`,
      detail: [day, fixture.competition.short_name ?? fixture.competition.name, round]
        .filter((part): part is string => part !== null && part !== '')
        .join(' · '),
      known: true,
    };
  }

  return {
    eyebrow,
    name: team.localised_name ?? team.name,
    competition:
      main === null
        ? { name: 'No current competition on record', known: false }
        : { name: main.competition.short_name ?? main.competition.name, known: true },
    standing,
    next,
    asOf: `As of ${cardDay(now, { day: 'numeric', month: 'short', year: 'numeric' })}`,
  };
}

/** How long a club's card may be kept while its next match is close or under way (rev-2026-11-13-08). */
export const TEAM_CARD_SHORT_SECONDS = 300;
/** How long it may be kept otherwise: its standing and next match move slowly (D-420). */
export const TEAM_CARD_LONG_SECONDS = 3600;

/**
 * The team card's `cache-control` (T-1826, D-420; rev-2026-11-13-08): five
 * minutes when the next match is live, suspended, or kicks off within the
 * hour -- its label and day are about to change -- and an hour otherwise.
 */
export function teamCardCacheControl(
  next: Pick<TeamPageFixture, 'status' | 'kickoff_at'> | null,
  now: Date,
): string {
  const close =
    next !== null &&
    (next.status === 'live' ||
      next.status === 'suspended' ||
      new Date(next.kickoff_at).getTime() - now.getTime() <= 60 * 60 * 1000);
  return `public, max-age=${close ? TEAM_CARD_SHORT_SECONDS : TEAM_CARD_LONG_SECONDS}`;
}

/**
 * The team card's fixture line (T-1826; code review of pull request 888): 56px as
 * drawn while it fits on one line, a step down to keep a longer pair on one
 * line ("Borussia Dortmund v Bayer Leverkusen", 36 letters, at 44px), and a
 * smaller size beyond that, which the card clamps to two lines. The panel
 * holding it has a fixed height, so the "As of" date under it is always
 * clear.
 */
export function teamFixtureSize(match: string): number {
  if (match.length <= 28) return 56;
  if (match.length <= 36) return 44;
  return 34;
}

/** The team card's name size: 90px as drawn, smaller for a long name, which then takes two lines. */
export function teamNameSize(name: string): number {
  if (name.length <= 16) return 90;
  if (name.length <= 26) return 64;
  return 52;
}
