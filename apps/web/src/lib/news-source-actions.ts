'use server';

import { revalidatePath } from 'next/cache';
import type { NewsFeedPreview, NewsSourceWriteResponse } from '@fmip/contracts';
import { failureState } from '@/lib/action-failure';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * News sources from the console (T-1015), over the audited API: reading a
 * feed once before it is added, adding, editing and dropping. Which checks a
 * feed must pass, and who may do any of it, are the API's; the reason is
 * required here too, so an administrator is told before the round trip.
 */

export type PreviewState =
  | null
  | { ok: true; preview: NewsFeedPreview }
  | { ok: false; message: string; fields?: Record<string, string>; refused?: true };

const FIELDS = ['name', 'homepage_url', 'feed_url', 'kind', 'rights', 'language'] as const;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function needReason(formData: FormData): ActionState {
  return text(formData, 'reason') === ''
    ? {
        ok: false,
        message: 'Say why. Every change to a news source records its reason.',
        fields: { reason: 'Required.' },
      }
    : null;
}

export async function previewNewsFeedAction(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const feedUrl = text(formData, 'feed_url');
  if (feedUrl === '') {
    return { ok: false, message: "Paste the feed's address.", fields: { feed_url: 'Required.' } };
  }
  const result = await apiRequest<NewsFeedPreview>('/admin/news-sources/preview', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { feed_url: feedUrl },
  });
  if (!result.ok) return failureState(result);
  return { ok: true, preview: result.data };
}

export async function addNewsSourceAction(
  locale: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missing = needReason(formData);
  if (missing !== null) return missing;
  const body: Record<string, string | boolean> = { reason: text(formData, 'reason') };
  for (const field of FIELDS) body[field] = text(formData, field);
  if (formData.has('same_language_only')) {
    body.same_language_only = text(formData, 'same_language_only') === 'true';
  }
  const result = await apiRequest<NewsSourceWriteResponse>('/admin/news-sources', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body,
  });
  if (!result.ok) return failureState(result);
  revalidatePath(`/${locale}/admin/news-sources`);
  return { ok: true, message: `Added ${result.data.source.name}; the next hourly read takes it.` };
}

export async function editNewsSourceAction(
  locale: string,
  sourceId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missing = needReason(formData);
  if (missing !== null) return missing;
  const body: Record<string, string> = { reason: text(formData, 'reason') };
  for (const field of FIELDS) {
    if (formData.has(field)) body[field] = text(formData, field);
  }
  const result = await apiRequest<NewsSourceWriteResponse>(
    `/admin/news-sources/${encodeURIComponent(sourceId)}`,
    { method: 'PATCH', cookie: await sessionCookieHeader(), body },
  );
  if (!result.ok) return failureState(result);
  revalidatePath(`/${locale}/admin/news-sources`);
  return {
    ok: true,
    message:
      result.data.preview === null
        ? 'Saved.'
        : 'Saved; the new feed address was read and robots.txt allows it.',
  };
}

/**
 * Who is shown the source's stories (T-1330, D-178): only readers of its
 * language, or every reader. `sameLanguageOnly` is the value asked for.
 */
export async function setNewsSourceVisibilityAction(
  locale: string,
  sourceId: string,
  sameLanguageOnly: boolean,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missing = needReason(formData);
  if (missing !== null) return missing;
  const result = await apiRequest<NewsSourceWriteResponse>(
    `/admin/news-sources/${encodeURIComponent(sourceId)}/visibility`,
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: { same_language_only: sameLanguageOnly, reason: text(formData, 'reason') },
    },
  );
  if (!result.ok) return failureState(result);
  revalidatePath(`/${locale}/admin/news-sources`);
  return {
    ok: true,
    message: sameLanguageOnly
      ? `Saved. Its stories are now shown only to readers in ${result.data.source.language}.`
      : 'Saved. Its stories are now shown to every reader.',
  };
}

export async function dropNewsSourceAction(
  locale: string,
  sourceId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const missing = needReason(formData);
  if (missing !== null) return missing;
  const result = await apiRequest<NewsSourceWriteResponse>(
    `/admin/news-sources/${encodeURIComponent(sourceId)}/drop`,
    {
      method: 'POST',
      cookie: await sessionCookieHeader(),
      body: { reason: text(formData, 'reason') },
    },
  );
  if (!result.ok) return failureState(result);
  revalidatePath(`/${locale}/admin/news-sources`);
  return {
    ok: true,
    message: 'Dropped. Its stories are no longer shown and its feed is not read.',
  };
}
