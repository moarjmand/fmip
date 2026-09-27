// Server-side only, like `session.ts`: `next/headers` has no client build.
import { cookies } from 'next/headers';
import {
  FIRST_RUN_COOKIE,
  FIRST_RUN_COOKIE_MAX_AGE,
  type GuestChoices,
  parseGuestChoices,
  serializeGuestChoices,
} from './first-run';

/** A guest's first-run choices (T-620), from this browser's cookie; `{}` when none. */
export async function readGuestChoices(): Promise<GuestChoices> {
  return parseGuestChoices((await cookies()).get(FIRST_RUN_COOKIE)?.value);
}

/** Only from a server action or route handler: a page cannot set a cookie. */
export async function writeGuestChoices(choices: GuestChoices): Promise<void> {
  (await cookies()).set({
    name: FIRST_RUN_COOKIE,
    value: serializeGuestChoices(choices),
    // Read by the server only; the page never needs it in script.
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: FIRST_RUN_COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Once the account holds the choices, the browser's copy has done its job. */
export async function clearGuestChoices(): Promise<void> {
  (await cookies()).delete(FIRST_RUN_COOKIE);
}
