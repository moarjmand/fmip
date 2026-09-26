import type { ForecastVersion, ModelProbabilities, ScoresGroup } from '@fmip/contracts';
import { coverageOf, roundToTotalOne } from '../../forecast/forecast.service';

/**
 * The day's post, as text (T-525). Pure: which matches, in what order, in
 * what words, split into how many messages -- every rule here is tested
 * without a database or a channel.
 *
 * **It is the statistical model's and says so on every message** (rule 6):
 * no founder's analysis and no community consensus is read here, so none can
 * be blended in or relabelled. A match the model has no forecast for is
 * listed with those words (rule 3), never with numbers from anywhere else.
 */

/** Telegram's ceiling for one message, and a sane one for any channel. */
export const MAX_MESSAGE_LENGTH = 4096;

/** The language of the post and of the pages it links to. */
export const POST_LOCALE = 'en';

/**
 * The day is the UTC day, and every time in the post is UTC and says so --
 * the zone a guest sees on the site (the homepage and the scores page fall
 * back to it without a member's own) and the zone the share cards are
 * written in (T-520), for the same reason: a channel is read by everyone at
 * once, and the post cannot know a reader's zone.
 */
export const POST_TIME_ZONE = 'UTC';

export interface PostForecast {
  /** Percentages to one decimal, totalling exactly 100. */
  percentages: ModelProbabilities;
  /** name@semver, as the model reported it. */
  modelVersion: string;
  /** The model worked from less than it wanted (`data_completeness: limited`). */
  limited: boolean;
}

export interface PostMatch {
  fixtureId: string;
  kickoffAt: string;
  home: string;
  away: string;
  /** Null when the model has no available forecast for this match. */
  forecast: PostForecast | null;
}

export interface PostCompetition {
  /** "England · Premier League", or the competition alone when it has no country. */
  title: string;
  matches: PostMatch[];
}

export interface DailyPost {
  day: string;
  messages: string[];
  fixtures: number;
  forecasts: number;
  modelVersions: string[];
}

/** The day (YYYY-MM-DD) an instant falls on, in the post's zone. */
export function postDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The three probabilities as percentages totalling exactly 100.0, the
 * largest absorbing the rounding gap -- the web's `percentages` (blueprint
 * 6.2), on the forecast boundary's own `roundToTotalOne`.
 */
export function percentages(p: ModelProbabilities): ModelProbabilities {
  const r = roundToTotalOne(p, 3);
  return {
    home: Math.round(r.home * 1000) / 10,
    draw: Math.round(r.draw * 1000) / 10,
    away: Math.round(r.away * 1000) / 10,
  };
}

/**
 * The day's matches worth a forecast, in the product's order.
 *
 * `groups` is the scores list a guest is given for the day, so the
 * competitions come in the order the product states (`display_order`,
 * T-504) and the matches in kick-off order. Kept: a match not yet started at
 * `now` -- a forecast is about a match to come, and a post that went out late
 * must not present one for a match already under way or over -- in a season
 * whose scores are not declared unsupplied. A postponed or cancelled match is
 * not on the day at all.
 */
export function selectMatches(
  groups: ScoresGroup[],
  latest: ReadonlyMap<string, ForecastVersion | null>,
  now: Date,
): PostCompetition[] {
  const competitions: PostCompetition[] = [];
  for (const group of groups) {
    const matches: PostMatch[] = group.fixtures
      .filter(
        (card) =>
          card.status === 'scheduled' &&
          Date.parse(card.kickoff_at) > now.getTime() &&
          card.coverage !== 'not_supplied',
      )
      .map((card) => ({
        fixtureId: card.id,
        kickoffAt: card.kickoff_at,
        home: card.home.name,
        away: card.away.name,
        forecast: forecastOf(latest.get(card.id) ?? null),
      }));
    if (matches.length === 0) continue;
    competitions.push({
      title:
        group.country === null
          ? group.competition.name
          : `${group.country.name} · ${group.competition.name}`,
      matches,
    });
  }
  return competitions;
}

/** Only the published model's latest version, and only when it is available. */
function forecastOf(latest: ForecastVersion | null): PostForecast | null {
  if (latest === null || latest.probabilities === null) return null;
  const coverage = coverageOf(latest);
  if (coverage === 'not_supplied') return null;
  return {
    percentages: percentages(latest.probabilities),
    modelVersion: latest.model_version,
    limited: coverage === 'limited',
  };
}

/** "Saturday 27 September 2026". */
export function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: POST_TIME_ZONE,
  })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(',', '');
}

/** "14:00". */
export function kickoffTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: POST_TIME_ZONE,
  }).format(new Date(iso));
}

export function matchUrl(origin: string, fixtureId: string): string {
  return `${origin.replace(/\/+$/, '')}/${POST_LOCALE}/match/${fixtureId}`;
}

function header(day: string, versions: string[], part: number, total: number): string {
  const title =
    `FMIP · The statistical model's forecast · ${dayLabel(day)}` +
    (total > 1 ? ` (${part}/${total})` : '');
  const source =
    versions.length === 0
      ? 'The statistical model has no forecast for these matches.'
      : versions.length === 1
        ? `Home win, draw and away win probabilities from the statistical model (${versions[0]}).`
        : `Home win, draw and away win probabilities from the statistical model (${versions.join(', ')}; each line names its version).`;
  return `${title}\n${source} Kick-off times in UTC.`;
}

function matchText(match: PostMatch, origin: string, nameVersion: boolean): string {
  const f = match.forecast;
  const line =
    f === null
      ? 'No forecast from the statistical model'
      : `${match.home} ${f.percentages.home}% · Draw ${f.percentages.draw}% · ${match.away} ${f.percentages.away}%` +
        (f.limited ? ' · limited data' : '') +
        (nameVersion ? ` · ${f.modelVersion}` : '');
  return `${kickoffTime(match.kickoffAt)}  ${match.home} v ${match.away}\n${line}\n${matchUrl(origin, match.fixtureId)}`;
}

const GAP = '\n\n';

/**
 * The day's post, split into messages of at most `limit` characters, or null
 * when the day has no match to post -- a day with no matches posts nothing.
 *
 * Messages break between competitions; a competition is cut between matches
 * only when it alone is longer than a message, and its next part carries its
 * name again. Every message opens with the same two lines, so each one read
 * alone in the channel still says whose forecast it is.
 */
export function composeDailyPost(
  day: string,
  competitions: PostCompetition[],
  origin: string,
  limit = MAX_MESSAGE_LENGTH,
): DailyPost | null {
  const matches = competitions.flatMap((c) => c.matches);
  if (matches.length === 0) return null;

  const versions = [
    ...new Set(matches.flatMap((m) => (m.forecast === null ? [] : [m.forecast.modelVersion]))),
  ].sort();
  const nameVersion = versions.length > 1;
  // Room for the widest header the post could need, so the counter added
  // after packing can never push a message over the limit.
  const budget = limit - header(day, versions, 999, 999).length - GAP.length;

  const bodies: string[][] = [];
  let current: string[] = [];
  const length = (blocks: string[]): number => blocks.join(GAP).length;
  const flush = (): void => {
    if (current.length > 0) bodies.push(current);
    current = [];
  };

  for (const competition of competitions) {
    const chunks = competition.matches.map((m) => matchText(m, origin, nameVersion));
    const whole = [competition.title, ...chunks].join(GAP);
    if (length([...current, whole]) <= budget) {
      current.push(whole);
      continue;
    }
    flush();
    if (whole.length <= budget) {
      current.push(whole);
      continue;
    }
    // One competition longer than a message: cut between its matches.
    let piece: string[] = [competition.title];
    for (const chunk of chunks) {
      if (piece.length > 1 && length([...piece, chunk]) > budget) {
        bodies.push([piece.join(GAP)]);
        piece = [`${competition.title} (continued)`];
      }
      piece.push(chunk);
    }
    current.push(piece.join(GAP));
  }
  flush();

  return {
    day,
    messages: bodies.map(
      (blocks, i) => `${header(day, versions, i + 1, bodies.length)}${GAP}${blocks.join(GAP)}`,
    ),
    fixtures: matches.length,
    forecasts: matches.filter((m) => m.forecast !== null).length,
    modelVersions: versions,
  };
}
