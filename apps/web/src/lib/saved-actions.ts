'use server';

import type { SavedArticlesResponse } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { apiRequest } from './api';
import { sessionCookieHeader } from './session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The pages that show whether a story is saved (T-842). */
function revalidate(locale: string, storyId: string): void {
  revalidatePath(`/${locale}/news`);
  revalidatePath(`/${locale}/news/story/${storyId}`);
  revalidatePath(`/${locale}/following/saved`);
}

/** Save a story to the member's list (T-842). A story id that is not one is ignored. */
export async function saveArticleAction(locale: string, formData: FormData): Promise<void> {
  const storyId = String(formData.get('story_id') ?? '');
  if (!UUID.test(storyId)) return;
  await apiRequest<SavedArticlesResponse>(`/me/saved-articles/${encodeURIComponent(storyId)}`, {
    method: 'PUT',
    cookie: await sessionCookieHeader(),
  });
  revalidate(locale, storyId);
}

/** Remove a story from the member's list (T-842). */
export async function unsaveArticleAction(locale: string, formData: FormData): Promise<void> {
  const storyId = String(formData.get('story_id') ?? '');
  if (!UUID.test(storyId)) return;
  await apiRequest<SavedArticlesResponse>(`/me/saved-articles/${encodeURIComponent(storyId)}`, {
    method: 'DELETE',
    cookie: await sessionCookieHeader(),
  });
  revalidate(locale, storyId);
}
