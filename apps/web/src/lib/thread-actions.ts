'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Opening a group's thread about a match (T-248).
 *
 * **There is no "does it exist yet" question here, and that is deliberate.**
 * `POST /groups/:slug/threads` is idempotent (T-244): two members reaching for
 * the same match get the same room. So the control is one button whatever the
 * state, and the page does not have to ask a question per group before it can
 * draw itself — which for a member in six groups would have been six requests
 * to render one line.
 */
export async function openThreadAction(
  locale: string,
  slug: string,
  fixtureId: string,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await apiRequest<{ id: string }>(`/groups/${encodeURIComponent(slug)}/threads`, {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { fixture_id: fixtureId },
  });
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

  revalidatePath(`/${locale}/messages`);
  // Straight into the room. A member who pressed "discuss this match" wants to
  // be in the conversation, not told that one now exists.
  redirect(`/${locale}/messages/${result.data.id}`);
}
