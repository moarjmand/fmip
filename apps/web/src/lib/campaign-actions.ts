'use server';

import type {
  AudienceFilter,
  AudienceFollowType,
  CreateAudienceRequest,
  CreateCampaignRequest,
  SendCampaignRequest,
} from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import type { ActionState } from './auth-actions';
import { sessionCookieHeader } from './session';

/**
 * Campaigns from the administration area (T-332, D-075). Each action is one
 * audited API call with a reason; the API decides who may, what the
 * vocabulary is and whether a send is the first. Failures come back as
 * state the page shows, never as a thrown error.
 */
const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

async function post(
  path: string,
  body: unknown,
  locale: string,
): Promise<Exclude<ActionState, null>> {
  const result = await apiRequest(path, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error?.message ??
        (result.status === 0 ? 'The service is unreachable right now.' : 'The request failed.'),
    };
  }
  revalidatePath(`/${locale}/admin/campaigns`);
  return { ok: true };
}

export async function createAudienceAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const filter: AudienceFilter = {};
  const followType = text(formData, 'follows_type');
  const followId = text(formData, 'follows_id');
  if (followType !== '' && followType !== 'none') {
    if (followId === '')
      return { ok: false, message: 'A followed team or competition needs its id.' };
    filter.follows = { type: followType as AudienceFollowType, id: followId };
  }
  const country = text(formData, 'country_id');
  if (country !== '') filter.country_id = country;
  const language = text(formData, 'language');
  if (language !== '' && language !== 'any') filter.language = language;
  if (formData.get('verified_only') === 'on') filter.verified_only = true;
  const joined = text(formData, 'joined_after');
  if (joined !== '') filter.joined_after = joined;
  const body: CreateAudienceRequest = {
    name: text(formData, 'name'),
    filter,
    reason: text(formData, 'reason'),
  };
  const outcome = await post('/admin/audiences', body, locale);
  return outcome.ok ? { ok: true, message: 'Audience saved.' } : outcome;
}

export async function createCampaignAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: CreateCampaignRequest = {
    audience_id: text(formData, 'audience_id'),
    title: text(formData, 'title'),
    body: text(formData, 'body'),
    path: text(formData, 'path'),
    reason: text(formData, 'reason'),
  };
  const outcome = await post('/admin/campaigns', body, locale);
  return outcome.ok
    ? { ok: true, message: 'Campaign created; it is sent when you say so.' }
    : outcome;
}

export async function sendCampaignAction(
  locale: string,
  campaignId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const body: SendCampaignRequest = { reason: text(formData, 'reason') };
  const outcome = await post(
    `/admin/campaigns/${encodeURIComponent(campaignId)}/send`,
    body,
    locale,
  );
  return outcome.ok
    ? { ok: true, message: 'Sent. The report below says who it reached.' }
    : outcome;
}
