'use server';

import { revalidatePath } from 'next/cache';
import { followAction, unfollowAction } from './auth-actions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Follow or unfollow a team or competition from a story page (T-941). The
 * same `/me/following` write the settings page makes (T-042), through the
 * same actions, then the story is rendered again so the control shows what is
 * now true. Only the two types a story offers are accepted.
 */
export async function storyFollowAction(
  locale: string,
  storyId: string,
  formData: FormData,
): Promise<void> {
  const type = String(formData.get('entity_type') ?? '');
  const id = String(formData.get('entity_id') ?? '');
  if ((type !== 'team' && type !== 'competition') || !UUID.test(id)) return;
  if (formData.get('intent') === 'unfollow') await unfollowAction(locale, formData);
  else await followAction(locale, formData);
  if (UUID.test(storyId)) revalidatePath(`/${locale}/news/story/${storyId}`);
}
