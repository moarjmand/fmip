'use server';

import { revalidatePath } from 'next/cache';
import { apiRequest } from '@/lib/api';
import type { ActionState } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Reacting to a panel post, and following a contributor (T-252).
 *
 * **Neither action checks whether the member may post**, and there is nothing
 * to check: reacting and following are open to any member. A permission test
 * here would be the browser's copy of a rule that has no business existing --
 * the acceptance criterion is precisely that these never become posting access,
 * and the way to keep that true is to have no gate to get wrong.
 *
 * Both are idempotent at the API (`PUT`/`DELETE`), so a double submit from an
 * impatient tap changes nothing, and neither needs a confirmation.
 */

async function send(
  path: string,
  method: 'PUT' | 'DELETE',
  revalidate: string,
): Promise<ActionState> {
  const result = await apiRequest(path, { method, cookie: await sessionCookieHeader() });
  if (!result.ok) {
    if (result.status === 0) {
      return {
        ok: false,
        message: 'The service is unreachable right now. Please try again shortly.',
      };
    }
    // The sentence the API sent, shown as it came. It is the one derived from
    // what the database actually refused.
    return {
      ok: false,
      message: result.error?.message ?? `The request failed (HTTP ${result.status}).`,
    };
  }
  revalidatePath(revalidate);
  return { ok: true };
}

export async function setPanelReactionAction(
  locale: string,
  fixtureId: string,
  postId: string,
  reaction: string,
  on: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return send(
    `/panel-posts/${encodeURIComponent(postId)}/reactions/${encodeURIComponent(reaction)}`,
    on ? 'PUT' : 'DELETE',
    `/${locale}/match/${fixtureId}`,
  );
}

export async function setFollowAction(
  locale: string,
  fixtureId: string,
  username: string,
  on: boolean,
  _previous: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return send(
    `/members/${encodeURIComponent(username)}/follow`,
    on ? 'PUT' : 'DELETE',
    `/${locale}/match/${fixtureId}`,
  );
}
