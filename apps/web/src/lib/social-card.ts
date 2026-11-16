import type {
  SocialCardGoal,
  SocialCardModel,
  SocialCardPayload,
  SocialCardResponse,
  SocialCardTeam,
  SocialOutcome,
  SocialResultPayload,
  SocialVerdictPayload,
} from '@fmip/contracts';
import { initials } from '@/components/entity-image';
import { type ApiResult, apiRequest } from '@/lib/api';
import { cardName } from '@/lib/share-card';

/**
 * The social cards' words (T-1835, D-427 point 11): what the 1080 x 1350
 * picture of a post says, from the post's frozen payload alone, so the
 * preview a person approves is the picture the network gets. English, Night,
 * no crest, logo or photo -- a team's badge is its three-letter code where
 * the site has one, else two initials. One product a card (rule 6): the
 * forecast and the check name the statistical model and its version and
 * nothing of the founder or the community; the result names no prediction.
 */

/** 4:5, the size X and Instagram both show whole in a feed. */
export const SOCIAL_CARD_SIZE = { width: 1080, height: 1350 } as const;

/**
 * A published post's card never changes (its payload is frozen) and the post
 * can no longer be withdrawn, so its picture is kept for good.
 */
export const SOCIAL_CARD_CACHE = 'public, max-age=31536000, immutable';

/**
 * A post still waiting (pending, approved, publishing, refused, unknown) may
 * yet be rejected, expire or be superseded, and then its card answers 404
 * (D-427 point 11): until it is published its picture is stored nowhere.
 */
export const UNPUBLISHED_CARD_CACHE = 'private, no-store';

/** The London clock the posts' times are written in ("UK time"). */
const LONDON = 'Europe/London';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A post's id as the route takes it: a UUID, or nothing worth asking the API about. */
export function isSocialPostId(id: string): boolean {
  return UUID.test(id);
}

/**
 * `GET /social-posts/:id/card`: a live post's frozen payload. **No cookie**:
 * the post's random id is the whole permission, so the publisher can fetch
 * the picture; 404 for an unknown, `rejected`, `expired` or `superseded` one.
 */
export function fetchSocialCard(id: string): Promise<ApiResult<SocialCardResponse>> {
  return apiRequest<SocialCardResponse>(`/social-posts/${encodeURIComponent(id)}/card`);
}

/**
 * A team's badge: its three-letter code where the site has one (so Newcastle
 * and Norway are NEW and NOR, never two "N"s), else two initials -- the first
 * letters of the first two words, or the first two letters of a one-word name.
 */
export function badgeLetters(team: SocialCardTeam): string {
  const code = team.code?.trim() ?? '';
  if (/^[\p{L}\p{N}]{3}$/u.test(code)) return code.toLocaleUpperCase('en');
  const letters = initials(team.name, 'crest');
  if (Array.from(letters).length >= 2) return letters;
  const word = Array.from(team.name.trim().replace(/[^\p{L}\p{N}]/gu, ''));
  return word.slice(0, 2).join('').toLocaleUpperCase('en');
}

/** The name a card prints: the short name past 18 characters, as the share cards do. */
export function socialName(team: SocialCardTeam): string {
  return cardName(team);
}

/**
 * The type size of a team's name under its badge (two lines at most in the
 * column's 400 px). Archivo 800 runs about 0.6 em a letter.
 */
export function socialNameSize(name: string): number {
  const longest = Math.max(...name.split(/\s+/).map((word) => word.length));
  if (name.length <= 10 && longest <= 10) return 56;
  if (name.length <= 14 && longest <= 12) return 48;
  return longest <= 14 ? 42 : 36;
}

/**
 * The three shares as numbers to print: with one decimal when any of them
 * has one (as the match page writes them, 17.7 / 25.3 / 57.0), whole when
 * all three are whole -- never a precision the payload does not hold.
 */
export function shareTexts(percent: Record<SocialOutcome, number>): Record<SocialOutcome, string> {
  const decimals = [percent.home, percent.draw, percent.away].some((p) => !Number.isInteger(p))
    ? 1
    : 0;
  return {
    home: percent.home.toFixed(decimals),
    draw: percent.draw.toFixed(decimals),
    away: percent.away.toFixed(decimals),
  };
}

/** "Sat 21 Nov · 17:30 UK time". */
export function kickOffText(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: LONDON,
  })
    .format(at)
    .replace(',', '');
  return `${day} · ${londonClock(at)} UK time`;
}

/** "Sat 14 Nov 2026", the match's day in London. */
export function matchDayText(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: LONDON,
  })
    .format(new Date(iso))
    .replace(',', '');
}

function londonClock(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: LONDON,
  }).format(at);
}

/** "14 Nov · 09:55 UK time", when the forecast was computed. */
function computedText(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: LONDON,
  }).format(at);
  return `Computed ${day} · ${londonClock(at)} UK time`;
}

const score = (s: { home: number; away: number }): string => `${s.home}–${s.away}`;

/** "88′ pen.", "45+2′", "12′ o.g." */
export function goalMinute(goal: SocialCardGoal): string {
  const minute = goal.added === null ? `${goal.minute}′` : `${goal.minute}+${goal.added}′`;
  if (goal.kind === 'penalty') return `${minute} pen.`;
  if (goal.kind === 'own_goal') return `${minute} o.g.`;
  return minute;
}

export interface SocialBadge {
  letters: string;
  name: string;
  nameSize: number;
}

export interface SocialShare {
  outcome: SocialOutcome;
  label: string;
  value: string;
  /** The bar segment's width, in hundredths. */
  weight: number;
  /** 1 for the largest share: its number is the model's colour, the others muted. */
  rank: 1 | 2 | 3;
}

interface SocialCardCommon {
  /** The chip at the top right. */
  chip: string;
  /** The competition, and the round when known, in capitals. */
  eyebrow: string;
  home: SocialBadge;
  away: SocialBadge;
}

/** The statistical model as the source line names it (rule 6). */
export interface SocialModelLine {
  name: string;
  version: string;
  computed: string;
}

export interface SocialForecastText extends SocialCardCommon {
  kind: 'forecast_pre_match';
  kickOff: string;
  shares: SocialShare[];
  model: SocialModelLine;
}

export interface SocialVerdictText extends SocialCardCommon {
  kind: 'model_verdict';
  correct: boolean;
  verdict: string;
  score: string;
  /** "After 90 minutes" when the match went further: the score the forecast was judged on. */
  scoreNote: string | null;
  /** The frozen bar, when the payload carries the three shares. */
  shares: SocialShare[] | null;
  /** What happened over 90 minutes, as an outcome. */
  happened: SocialOutcome;
  /** The outcome the model gave the most. */
  called: SocialOutcome;
  pick: { label: string; value: string };
  /** "Its pick: Celta Vigo win, 85.5%". */
  pickLine: string;
  /** "Result: Celta Vigo win", or "After 90 minutes: Draw" when the match went further. */
  outcomeLine: string;
  model: SocialModelLine;
}

export interface SocialScorer {
  player: string;
  minute: string;
}

export interface SocialResultText extends SocialCardCommon {
  kind: 'result';
  score: string;
  /** "FT · HT 0–0", "AET", "AET · Pens 4–3". */
  status: string;
  /** Null when the payload does not carry every goal: then no scorer is listed (rule 3). */
  scorers: { home: SocialScorer[]; away: SocialScorer[] } | null;
  date: string;
}

export type SocialCardText = SocialForecastText | SocialVerdictText | SocialResultText;

function badge(team: SocialCardTeam): SocialBadge {
  const name = socialName(team);
  return { letters: badgeLetters(team), name, nameSize: socialNameSize(name) };
}

function eyebrow(payload: SocialCardPayload): string {
  const round = payload.round?.trim() ?? '';
  const parts = [payload.competition.name, ...(round === '' ? [] : [round])];
  return parts.join(' · ').toLocaleUpperCase('en');
}

function outcomeLabel(outcome: SocialOutcome, home: string, away: string): string {
  if (outcome === 'draw') return 'Draw';
  return outcome === 'home' ? home : away;
}

/** "Celta Vigo win", "Draw". */
function resultWords(outcome: SocialOutcome, home: string, away: string): string {
  return outcome === 'draw' ? 'Draw' : `${outcomeLabel(outcome, home, away)} win`;
}

function shares(percent: Record<SocialOutcome, number>, home: string, away: string): SocialShare[] {
  const values = shareTexts(percent);
  const outcomes = ['home', 'draw', 'away'] as const;
  return outcomes.map((outcome) => ({
    outcome,
    label: outcomeLabel(outcome, home, away),
    value: values[outcome],
    weight: Math.max(percent[outcome], 0),
    // Equal shares share a rank: two equal largest are both the model's colour.
    rank: (1 + outcomes.filter((o) => percent[o] > percent[outcome]).length) as 1 | 2 | 3,
  }));
}

function modelLine(model: SocialCardModel): SocialModelLine {
  return { name: model.name, version: model.version, computed: computedText(model.computed_at) };
}

/**
 * A verdict payload that contradicts itself is refused, never drawn
 * (review of PR 894): the stored `correct` is read, not recomputed (D-209),
 * but it must agree with the pick and the 90-minute score beside it, and the
 * pick must be the largest of the frozen shares.
 */
function checkVerdict(payload: SocialVerdictPayload, happened: SocialOutcome): void {
  if (payload.correct !== (payload.called === happened)) {
    throw new Error('The verdict contradicts its pick and score.');
  }
  const p = payload.percent;
  if (p != null && p[payload.called] < Math.max(p.home, p.draw, p.away)) {
    throw new Error("The verdict's pick is not the forecast's largest share.");
  }
}

/** "FT · HT 0–0", "AET", "AET · Pens 4–3", "FT · Pens 4–3" (straight to a shoot-out). */
export function resultStatus(payload: SocialResultPayload): string {
  const parts = [payload.after_extra_time ? 'AET' : 'FT'];
  if (payload.half_time != null) parts.push(`HT ${score(payload.half_time)}`);
  if (payload.penalties !== null) parts.push(`Pens ${score(payload.penalties)}`);
  return parts.join(' · ');
}

function outcomeOf(s: { home: number; away: number }): SocialOutcome {
  if (s.home === s.away) return 'draw';
  return s.home > s.away ? 'home' : 'away';
}

/** The goals listed under each side, only when they are all there. */
function scorers(
  goals: SocialCardGoal[] | null | undefined,
  total: { home: number; away: number },
): SocialResultText['scorers'] {
  if (goals == null) return null;
  const side = (s: 'home' | 'away') =>
    goals.filter((g) => g.side === s).map((g) => ({ player: g.player, minute: goalMinute(g) }));
  const home = side('home');
  const away = side('away');
  // A list that does not add up to the score is a partial one: none at all.
  if (home.length !== total.home || away.length !== total.away) return null;
  return { home, away };
}

/** A card's words from the post's frozen payload. */
export function socialCardText(payload: SocialCardPayload): SocialCardText {
  const common = {
    eyebrow: eyebrow(payload),
    home: badge(payload.home),
    away: badge(payload.away),
  };
  const home = common.home.name;
  const away = common.away.name;
  switch (payload.kind) {
    case 'forecast_pre_match':
      return {
        ...common,
        kind: payload.kind,
        chip: 'Model forecast',
        kickOff: kickOffText(payload.kick_off),
        shares: shares(payload.percent, home, away),
        model: modelLine(payload.model),
      };
    case 'model_verdict': {
      const happened = outcomeOf(payload.score);
      checkVerdict(payload, happened);
      const pickValue = payload.percent
        ? shareTexts(payload.percent)[payload.called]
        : String(payload.called_percent);
      return {
        ...common,
        kind: payload.kind,
        chip: 'Model check',
        correct: payload.correct,
        verdict: payload.correct ? 'The model got it right.' : 'The model missed this one.',
        score: score(payload.score),
        scoreNote: payload.after_extra_time ? 'After 90 minutes' : null,
        shares: payload.percent ? shares(payload.percent, home, away) : null,
        happened,
        called: payload.called,
        pick: { label: resultWords(payload.called, home, away), value: pickValue },
        pickLine: `Its pick: ${resultWords(payload.called, home, away)}, ${pickValue}%`,
        outcomeLine: `${payload.after_extra_time ? 'After 90 minutes' : 'Result'}: ${resultWords(happened, home, away)}`,
        model: modelLine(payload.model),
      };
    }
    case 'result': {
      return {
        ...common,
        kind: payload.kind,
        chip: 'Full time',
        score: score(payload.score),
        status: resultStatus(payload),
        scorers: scorers(payload.goals, payload.score),
        date: matchDayText(payload.kick_off),
      };
    }
  }
}
