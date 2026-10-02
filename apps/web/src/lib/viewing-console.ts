import {
  VIEWING_ACCESS,
  VIEWING_BULK_MAX,
  type BroadcasterKind,
  type CoverageState,
  type ViewingAccess,
  type ViewingBulkRequest,
  type ViewingOption,
  type ViewingUpcomingFixture,
} from '@fmip/contracts';

/**
 * The Watch listings console's pure pieces (T-1361): reading the page's query,
 * which matches the bulk form starts with ticked, the bulk request built from
 * the form, and the words the console shows. The console is English only
 * (D-175), so these are plain English rather than catalogue keys.
 */

/** The territory the desk answers for when none is asked: the platform's own audience. */
export const CONSOLE_TERRITORY = 'IR';
/** The upcoming window's length when none is asked; the API takes 1 to 21. */
export const CONSOLE_DAYS = 7;
export const CONSOLE_DAYS_MAX = 21;

export interface ConsoleQuery {
  territory: string;
  /** The competition asked for, as given; whether it exists is the competitions list's to say. */
  competition: string | null;
  days: number;
}

/** `?territory=&competition=&days=`: a code that is not two letters, or days out of range, fall back to the defaults. */
export function readConsoleQuery(query: {
  territory?: string | string[];
  competition?: string | string[];
  days?: string | string[];
}): ConsoleQuery {
  const one = (value: string | string[] | undefined): string =>
    (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
  const territory = one(query.territory);
  const competition = one(query.competition);
  const days = Number(one(query.days));
  return {
    territory: /^[A-Za-z]{2}$/.test(territory) ? territory.toUpperCase() : CONSOLE_TERRITORY,
    competition: /^[0-9A-Za-z-]{1,64}$/.test(competition) ? competition : null,
    days: Number.isInteger(days) && days >= 1 && days <= CONSOLE_DAYS_MAX ? days : CONSOLE_DAYS,
  };
}

/** Covered for listing: what the API requires before a default or a bulk listing. */
export function isCovered(state: CoverageState | null): boolean {
  return state === 'available' || state === 'limited';
}

export function coverageLabel(state: CoverageState | null): string {
  switch (state) {
    case 'available':
      return 'covered';
    case 'limited':
      return 'partly covered';
    case 'not_supplied':
      return 'not covered';
    case 'delayed':
      return 'delayed';
    default:
      return 'nothing declared';
  }
}

export const ACCESS_LABEL: Record<ViewingAccess, string> = {
  free: 'Free',
  registration: 'Free with registration',
  subscription: 'Subscription',
  pay_per_view: 'Pay-per-view',
};

export const KIND_LABEL: Record<BroadcasterKind, string> = {
  tv: 'TV',
  streaming: 'Streaming',
  radio: 'Radio',
};

/** The badge a listing carries: `default` when a standing default created it, none when entered by hand. */
export function listingBadge(option: ViewingOption): 'default' | null {
  return option.from_default ? 'default' : null;
}

/**
 * Ticked when the bulk form opens: a covered match with nothing listed yet.
 * An uncovered one is never ticked (the API refuses the whole request for it),
 * and one already listed is left for the editor to choose.
 */
export function preChecked(fixture: ViewingUpcomingFixture): boolean {
  return fixture.covered && fixture.options.length === 0;
}

/** "Home – Away", a side not yet known said as such. */
export function matchLabel(fixture: ViewingUpcomingFixture): string {
  return `${fixture.home?.name ?? 'To be decided'} – ${fixture.away?.name ?? 'To be decided'}`;
}

/** The stage, round and leg under the match, whichever are known. */
export function matchContext(fixture: ViewingUpcomingFixture): string {
  return [fixture.stage?.name, fixture.round, fixture.leg === null ? null : `leg ${fixture.leg}`]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(' · ');
}

/** The console's time convention (the news desk's): minutes, in UTC, said so. */
export function consoleTime(at: string): string {
  return `${at.slice(0, 16).replace('T', ' ')} UTC`;
}

export type BulkBuild =
  | { ok: true; request: ViewingBulkRequest }
  | { ok: false; message: string; fields?: Record<string, string> };

/** The bulk request from the form: the ticked matches (each once), the service, the access and the page. */
export function bulkRequestFrom(formData: FormData, territory: string): BulkBuild {
  const text = (name: string): string => String(formData.get(name) ?? '').trim();
  const fixtureIds = [
    ...new Set(
      formData
        .getAll('fixture_ids')
        .map((value) => String(value).trim())
        .filter((value) => value !== ''),
    ),
  ];
  const broadcasterId = text('broadcaster_id');
  const access = text('access');
  const url = text('url');
  const fields: Record<string, string> = {};
  if (broadcasterId === '') fields.broadcaster_id = 'Required.';
  if (!(VIEWING_ACCESS as readonly string[]).includes(access)) fields.access = 'Required.';
  if (url === '') fields.url = 'Required.';
  if (Object.keys(fields).length > 0) {
    return { ok: false, message: 'Fill in every required field.', fields };
  }
  if (fixtureIds.length === 0) return { ok: false, message: 'Tick at least one match.' };
  if (fixtureIds.length > VIEWING_BULK_MAX) {
    return { ok: false, message: `At most ${VIEWING_BULK_MAX} matches at once.` };
  }
  return {
    ok: true,
    request: {
      territory,
      broadcaster_id: broadcasterId,
      access: access as ViewingAccess,
      url,
      fixture_ids: fixtureIds,
    },
  };
}

function listings(count: number): string {
  return count === 1 ? '1 listing' : `${count} listings`;
}

/** What a bulk listing did: how many it created and how many it left because they were already listed. */
export function bulkOutcome(created: number, skipped: number): string {
  const made = `${listings(created)} created.`;
  if (skipped === 0) return made;
  return `${made} ${skipped} already listed on that service, left as ${skipped === 1 ? 'it was' : 'they were'}.`;
}

/** What adding a default did. */
export function defaultOutcome(applied: number): string {
  return `Default saved; ${listings(applied)} created.`;
}
