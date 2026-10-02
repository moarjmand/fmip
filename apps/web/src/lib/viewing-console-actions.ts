'use server';

import type { ViewingBulkResponse, ViewingDefaultResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { failureState } from '@/lib/action-failure';
import { sessionCookieHeader } from '@/lib/session';
import { bulkOutcome, bulkRequestFrom, defaultOutcome } from '@/lib/viewing-console';

/**
 * The Watch listings console's writes (T-1361), over the desk's API of T-313
 * and T-1360: declaring coverage for a competition's season in a territory,
 * adding a broadcaster, adding and removing a standing default, listing many
 * matches at once, and taking one listing down. Every write is an audit row
 * at the API (rule 10); every failure says the API's own sentence
 * (`failureState`, in English: the console is English only, D-175); every
 * success refreshes the console and, in every language, the Watch page and
 * the match pages that read the module.
 */

function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin/viewing`);
  revalidatePath('/[locale]/watch', 'page');
  revalidatePath('/[locale]/match/[id]', 'page');
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function missing(values: Record<string, string>, required: string[]): ActionState | null {
  const absent = required.filter((name) => values[name] === '');
  if (absent.length === 0) return null;
  return {
    ok: false,
    message: 'Fill in every required field.',
    fields: Object.fromEntries(absent.map((name) => [name, 'Required.'])),
  };
}

const NO_REASON: ActionState = {
  ok: false,
  message: 'Say why. This is recorded.',
  fields: { reason: 'Required.' },
};

async function send<T>(
  locale: string,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  done: (data: T) => string,
): Promise<ActionState> {
  const result = await apiRequest<T>(path, { method, cookie: await sessionCookieHeader(), body });
  if (!result.ok) return failureState(result);
  refresh(locale);
  return { ok: true, message: done(result.data) };
}

export async function declareConsoleCoverageAction(
  locale: string,
  seasonId: string,
  territory: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    module: field(formData, 'module'),
    state: field(formData, 'state'),
    note: field(formData, 'note'),
  };
  const gap = missing(values, ['module', 'state', 'note']);
  if (gap !== null) return gap;
  return send(
    locale,
    'PUT',
    '/admin/viewing/coverage',
    { season_id: seasonId, territory, ...values },
    () => `Coverage declared for ${territory}.`,
  );
}

export async function addConsoleBroadcasterAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    name: field(formData, 'name'),
    homepage_url: field(formData, 'homepage_url'),
    kind: field(formData, 'kind'),
  };
  const gap = missing(values, ['name', 'kind']);
  if (gap !== null) return gap;
  return send(
    locale,
    'POST',
    '/admin/viewing/broadcasters',
    { ...values, homepage_url: values.homepage_url === '' ? null : values.homepage_url },
    () => `${values.name} added.`,
  );
}

export async function addViewingDefaultAction(
  locale: string,
  competitionId: string,
  territory: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    broadcaster_id: field(formData, 'broadcaster_id'),
    access: field(formData, 'access'),
    url: field(formData, 'url'),
    note: field(formData, 'note'),
  };
  const gap = missing(values, ['broadcaster_id', 'access', 'url', 'note']);
  if (gap !== null) return gap;
  return send<ViewingDefaultResponse>(
    locale,
    'POST',
    '/admin/viewing/defaults',
    { competition_id: competitionId, territory, ...values },
    (data) => defaultOutcome(data.applied),
  );
}

export async function removeViewingDefaultAction(
  locale: string,
  defaultId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = field(formData, 'reason');
  if (reason === '') return NO_REASON;
  return send(
    locale,
    'POST',
    `/admin/viewing/defaults/${encodeURIComponent(defaultId)}/remove`,
    { reason },
    () => 'Default removed; its listings for matches not yet played are gone.',
  );
}

export async function bulkListAction(
  locale: string,
  territory: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const built = bulkRequestFrom(formData, territory);
  if (!built.ok) return built;
  return send<ViewingBulkResponse>(
    locale,
    'POST',
    '/admin/viewing/bulk-options',
    built.request,
    (data) => bulkOutcome(data.created, data.skipped.length),
  );
}

export async function removeConsoleListingAction(
  locale: string,
  fixtureId: string,
  optionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = field(formData, 'reason');
  if (reason === '') return NO_REASON;
  return send(
    locale,
    'POST',
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/viewing-options/${encodeURIComponent(optionId)}/remove`,
    { reason },
    () => 'Listing removed.',
  );
}
