'use server';

import { revalidatePath } from 'next/cache';
import type { GroupInviteLinkResponse } from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';
import { type ApiResult, apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { aboutPatch, inviteLinkUrl, linkRequest, parsePolicy } from '@/lib/group-settings';
import { siteUrl } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { failureMessage, isRefused } from './action-failure';

/**
 * What the owner, and whoever the policy lets invite, change from a group's
 * page (T-1026, over T-1020..T-1022). Server actions, so every form works
 * without JavaScript and the session cookie never leaves the server. Nothing
 * here decides anything: who may do what is the API's answer over the
 * schema's rules, and its sentence is passed through, refusals included.
 */

/** The state of the "make a link" form: the one time a link's token exists outside its holder's hands. */
export type InviteLinkActionState = ActionState | { ok: true; message: string; url: string };

async function failure(
  result: Extract<ApiResult<unknown>, { ok: false }>,
  locale: string,
): Promise<ActionState> {
  const fields = isRefused(result) ? undefined : result.error?.fields;
  const detail = fields === undefined ? '' : ` ${Object.values(fields).join(' ')}`;
  return {
    ok: false,
    message: `${await failureMessage(result, locale)}${detail}`,
    ...(isRefused(result) ? { refused: true as const } : {}),
  };
}

function said(locale: string, key: MessageKey): string {
  return t(isLocale(locale) ? locale : DEFAULT_LOCALE, key);
}

function groupPath(slug: string): string {
  return `/groups/${encodeURIComponent(slug)}`;
}

async function call(
  locale: string,
  slug: string,
  path: string,
  method: 'PUT' | 'PATCH' | 'DELETE',
  body: unknown,
  done: MessageKey,
): Promise<ActionState> {
  const result = await apiRequest<unknown>(`${groupPath(slug)}${path}`, {
    method,
    cookie: await sessionCookieHeader(),
    ...(body === undefined ? {} : { body }),
  });
  if (!result.ok) return failure(result, locale);
  revalidatePath(`/${locale}/groups`);
  revalidatePath(`/${locale}${groupPath(slug)}`);
  return { ok: true, message: said(locale, done) };
}

/** Who may invite (T-1020): the owner only, audited in the group's history. */
export async function setInvitePolicyAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    '/invite-policy',
    'PUT',
    { invite_policy: parsePolicy(formData.get('invite_policy')) },
    'groupSettings.policy.done',
  );
}

/** The group's language and favourite club or competition (T-1022), by id. */
export async function updateGroupAboutAction(
  locale: string,
  slug: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return call(locale, slug, '', 'PATCH', aboutPatch(formData), 'groupSettings.about.done');
}

/**
 * Make an invite link (T-1021). The answer carries the token once; it goes
 * back to the form that asked and nowhere else -- not into the page, not into
 * a cache -- because only its hash is stored and the list never shows it.
 */
export async function createInviteLinkAction(
  locale: string,
  slug: string,
  _previous: InviteLinkActionState,
  formData: FormData,
): Promise<InviteLinkActionState> {
  const result = await apiRequest<GroupInviteLinkResponse>(`${groupPath(slug)}/invite-links`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: linkRequest(formData),
  });
  if (!result.ok) return failure(result, locale);
  revalidatePath(`/${locale}${groupPath(slug)}`);
  return {
    ok: true,
    message: said(locale, 'groupSettings.links.created'),
    url: inviteLinkUrl(siteUrl(), locale, result.data.link.token),
  };
}

/** Revoke a link: the owner and moderators any, its maker their own (the API's rule). */
export async function revokeInviteLinkAction(
  locale: string,
  slug: string,
  linkId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return call(
    locale,
    slug,
    `/invite-links/${encodeURIComponent(linkId)}`,
    'DELETE',
    undefined,
    'groupSettings.links.revoked',
  );
}
