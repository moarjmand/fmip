'use server';

import type { PlatformRulesStanding } from '@fmip/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { sessionCookieHeader } from '@/lib/session';

/**
 * Accept the platform rules the member just read (T-931, D-113). The form
 * carries the version shown on the page; if a newer one was published while
 * they read, the API refuses it and the page shows them the newer text.
 * Every page's header asks until this succeeds, so the whole layout is
 * revalidated.
 */
export async function acceptRulesAction(locale: string, version: string): Promise<void> {
  const result = await apiRequest<PlatformRulesStanding>('/auth/rules/accept', {
    method: 'POST',
    cookie: await sessionCookieHeader(),
    body: { version },
  });
  const outcome = result.ok
    ? 'accepted'
    : result.status === 409
      ? 'newer'
      : result.status === 401
        ? 'signed-out'
        : 'failed';
  if (result.ok) revalidatePath(`/${locale}`, 'layout');
  redirect(`/${locale}/rules?outcome=${outcome}`);
}
