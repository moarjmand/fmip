import type { FirstRunState, TeamSummary } from '@fmip/contracts';
import { type Locale, isLocale, isPseudoLocale, localeFromPathname } from '@/i18n/locales';

/**
 * The first-run flow (blueprint 2.3 and 7.1, T-620): language, territory,
 * time zone and favourite teams, each skippable, offered once.
 *
 * A member's answers are stored on the account as they are given, through
 * the endpoints Settings already uses. A guest's are kept in one cookie --
 * nothing is stored about a visitor on the server -- and applied to the
 * account at sign-up (and at sign-in, for an account that never did the
 * flow), which is the acceptance criterion: a guest's choice survives until
 * sign-up. Everything here is pure; the cookie and the API calls are in
 * `first-run-actions.ts`.
 */

export const FIRST_RUN_COOKIE = 'fmip_first_run';
/** A year: long enough to reach a sign-up, short enough to be forgotten. */
export const FIRST_RUN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Favourite teams a guest can carry to sign-up; a first run is a start, not a migration. */
export const MAX_GUEST_TEAMS = 10;
/** How many teams the pick step lists for a search; the search narrows the rest. */
export const TEAM_RESULTS = 30;

export const STEPS = ['language', 'territory', 'timezone', 'teams'] as const;
export type Step = (typeof STEPS)[number];

/** What a guest chose, all optional: a skipped step is simply absent. */
export interface GuestChoices {
  language?: Locale;
  territory?: string;
  timezone?: string;
  teams?: string[];
  /** Went through to the end: the account receives it as its first run done. */
  done?: true;
  /** Said "not now" to the offer: hides the offer in this browser, and nothing more. */
  dismissed?: true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TERRITORY = /^[A-Z]{2}$/;
const TIMEZONES = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC']);

export function isTimeZone(value: string): boolean {
  return TIMEZONES.has(value);
}

/** A language a reader may be moved to: a real locale, never the pseudo-locale. */
function isLanguage(value: unknown): value is Locale {
  return typeof value === 'string' && isLocale(value) && !isPseudoLocale(value);
}

/**
 * The cookie, read defensively: it came back from a browser, so anything
 * malformed or unknown is dropped field by field rather than trusted or
 * thrown on. An unreadable cookie is a guest who chose nothing.
 */
export function parseGuestChoices(raw: string | undefined): GuestChoices {
  if (raw === undefined || raw === '') return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const choices: GuestChoices = {};
  if (isLanguage(v.language)) choices.language = v.language;
  if (typeof v.territory === 'string' && TERRITORY.test(v.territory)) {
    choices.territory = v.territory;
  }
  if (typeof v.timezone === 'string' && isTimeZone(v.timezone)) choices.timezone = v.timezone;
  if (Array.isArray(v.teams)) {
    const teams = [
      ...new Set(v.teams.filter((t): t is string => typeof t === 'string' && UUID.test(t))),
    ];
    if (teams.length > 0) choices.teams = teams.slice(0, MAX_GUEST_TEAMS);
  }
  if (v.done === true) choices.done = true;
  if (v.dismissed === true) choices.dismissed = true;
  return choices;
}

export function serializeGuestChoices(choices: GuestChoices): string {
  return JSON.stringify(choices);
}

/** Whether the guest has anything the account should receive. */
export function hasChoices(choices: GuestChoices): boolean {
  return (
    choices.language !== undefined ||
    choices.territory !== undefined ||
    choices.timezone !== undefined ||
    (choices.teams?.length ?? 0) > 0 ||
    choices.done === true
  );
}

export function readStep(value: string | string[] | undefined): Step {
  const v = Array.isArray(value) ? value[0] : value;
  return (STEPS as readonly string[]).includes(v ?? '') ? (v as Step) : 'language';
}

/** The step after this one, or `null` after the last. */
export function nextStep(step: Step): Step | null {
  return STEPS[STEPS.indexOf(step) + 1] ?? null;
}

/**
 * Where the flow sends a reader when it ends: `next` when it is a path on
 * this site under a locale, else the homepage. Never an absolute URL, so the
 * query string cannot be used to send someone elsewhere.
 */
export function afterFirstRun(locale: string, next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  if (
    n !== undefined &&
    n.startsWith('/') &&
    !n.startsWith('//') &&
    !/[\\\s]/.test(n) &&
    localeFromPathname(n.split(/[?#]/)[0] ?? '') !== undefined
  ) {
    return n;
  }
  return `/${locale}`;
}

/** The address of one step, keeping where the flow returns to. */
export function stepHref(locale: string, step: Step, next?: string): string {
  const query = new URLSearchParams({ step });
  if (next !== undefined) query.set('next', next);
  return `/${locale}/welcome?${query.toString()}`;
}

/**
 * The teams the pick step lists: those whose name, short name or code
 * contains the search (any case), else the first `TEAM_RESULTS` by name.
 * Teams already chosen are listed first so they can be unchosen.
 */
export function teamMatches(
  teams: readonly TeamSummary[],
  query: string,
  chosen: ReadonlySet<string>,
): TeamSummary[] {
  const q = query.trim().toLocaleLowerCase();
  const matching = teams.filter(
    (t) =>
      !chosen.has(t.id) &&
      (q === '' ||
        [t.name, t.short_name, t.code].some(
          (s) => s !== null && s.toLocaleLowerCase().includes(q),
        )),
  );
  return [...teams.filter((t) => chosen.has(t.id)), ...matching.slice(0, TEAM_RESULTS)];
}

/** One call the account receives at sign-up or sign-in, as the API spells it. */
export interface ApplyCall {
  method: 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
}

/**
 * What a guest's choices become on an account, in order, through the
 * endpoints Settings already uses. At **sign-up** everything is applied: the
 * account is new and the choices are its first. At **sign-in** they are
 * applied only to an account whose own flow is still pending -- a member who
 * already chose is never overwritten by what a browser remembers. Favourites
 * are only ever added, never removed.
 */
export function applyPlan(
  choices: GuestChoices,
  moment: 'sign_up' | 'sign_in',
  accountFirstRun: FirstRunState,
): ApplyCall[] {
  if (moment === 'sign_in' && accountFirstRun.state === 'done') return [];
  const calls: ApplyCall[] = [];
  const preferences: { preferred_language?: string; timezone?: string } = {};
  if (choices.language !== undefined) preferences.preferred_language = choices.language;
  if (choices.timezone !== undefined) preferences.timezone = choices.timezone;
  if (Object.keys(preferences).length > 0) {
    calls.push({ method: 'PATCH', path: '/me/preferences', body: preferences });
  }
  if (choices.territory !== undefined) {
    calls.push({ method: 'PUT', path: '/me/territory', body: { code: choices.territory } });
  }
  for (const team of choices.teams ?? []) {
    calls.push({ method: 'PUT', path: `/me/following/team/${team}`, body: { favourite: true } });
  }
  if (choices.done === true) calls.push({ method: 'PUT', path: '/me/first-run' });
  return calls;
}
