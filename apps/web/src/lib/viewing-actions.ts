'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The editorial desk's writes (T-313, D-069), from the match page itself:
 * declaring coverage, adding a broadcaster, listing this match on a service,
 * setting the official highlight page, and taking either down with a reason.
 * Every required word is checked here as well as at the API, so an editor is
 * told before the round trip rather than after it; every write is an audit
 * row at the API (rule 10).
 */
async function send(
  locale: string,
  fixtureId: string,
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, string | null>,
  done: string,
): Promise<ActionState> {
  const result = await apiRequest(path, { method, cookie: await sessionCookieHeader(), body });
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    };
  }
  // The match page and the Watch page both read the module; tell them it changed.
  revalidatePath(`/${locale}/match/${fixtureId}`);
  revalidatePath(`/${locale}/watch`);
  return { ok: true, message: done };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/** The first missing required field, as the state the form shows; `null` when all are there. */
function missing(values: Record<string, string>, required: string[]): ActionState | null {
  const absent = required.filter((name) => values[name] === '');
  if (absent.length === 0) return null;
  return {
    ok: false,
    message: 'Fill in every required field.',
    fields: Object.fromEntries(absent.map((name) => [name, 'Required.'])),
  };
}

export async function declareCoverageAction(
  locale: string,
  fixtureId: string,
  seasonId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    territory: field(formData, 'territory').toUpperCase(),
    module: field(formData, 'module'),
    state: field(formData, 'state'),
    note: field(formData, 'note'),
  };
  const gap = missing(values, ['territory', 'module', 'state', 'note']);
  if (gap !== null) return gap;
  return send(
    locale,
    fixtureId,
    'PUT',
    '/admin/viewing/coverage',
    { season_id: seasonId, ...values },
    `Coverage declared for ${values.territory}.`,
  );
}

export async function addBroadcasterAction(
  locale: string,
  fixtureId: string,
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
    fixtureId,
    'POST',
    '/admin/viewing/broadcasters',
    { ...values, homepage_url: values.homepage_url === '' ? null : values.homepage_url },
    `${values.name} added.`,
  );
}

export async function listOptionAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    territory: field(formData, 'territory').toUpperCase(),
    broadcaster_id: field(formData, 'broadcaster_id'),
    access: field(formData, 'access'),
    url: field(formData, 'url'),
  };
  const gap = missing(values, ['territory', 'broadcaster_id', 'access', 'url']);
  if (gap !== null) return gap;
  return send(
    locale,
    fixtureId,
    'POST',
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/viewing-options`,
    values,
    `Listed in ${values.territory}.`,
  );
}

export async function removeOptionAction(
  locale: string,
  fixtureId: string,
  optionId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = field(formData, 'reason');
  if (reason === '') {
    return { ok: false, message: 'Say why. This is recorded.', fields: { reason: 'Required.' } };
  }
  return send(
    locale,
    fixtureId,
    'POST',
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/viewing-options/${encodeURIComponent(optionId)}/remove`,
    { reason },
    'Listing removed.',
  );
}

export async function setHighlightAction(
  locale: string,
  fixtureId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = {
    territory: field(formData, 'territory').toUpperCase(),
    url: field(formData, 'url'),
  };
  const gap = missing(values, ['territory', 'url']);
  if (gap !== null) return gap;
  return send(
    locale,
    fixtureId,
    'PUT',
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/highlight`,
    values,
    `Highlight page set for ${values.territory}.`,
  );
}

export async function removeHighlightAction(
  locale: string,
  fixtureId: string,
  territory: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const reason = field(formData, 'reason');
  if (reason === '') {
    return { ok: false, message: 'Say why. This is recorded.', fields: { reason: 'Required.' } };
  }
  return send(
    locale,
    fixtureId,
    'POST',
    `/admin/fixtures/${encodeURIComponent(fixtureId)}/highlight/${encodeURIComponent(territory)}/remove`,
    { reason },
    'Highlight page removed.',
  );
}
