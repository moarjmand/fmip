import Link from 'next/link';
import { fetchMe } from '@/lib/api';
import { logoutAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

/**
 * The one navigation bar. Reads the session server-side; when the API is
 * unreachable the visitor is shown as signed out, which is the honest state:
 * nothing could be verified.
 */
export async function SiteHeader({ locale }: { locale: string }) {
  const me = await fetchMe(await sessionCookieHeader());
  const href = (path: string) => `/${locale}${path}`;

  return (
    <header className="border-b border-current/20">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-3xl flex-wrap items-center gap-4 px-8 py-3 text-sm"
      >
        <Link href={href('')} className="font-semibold">
          FMIP
        </Link>
        <Link href={href('/scores')} data-testid="nav-scores">
          Scores
        </Link>
        <Link href={href('/leaderboard')} className="me-auto" data-testid="nav-leaderboard">
          Leaderboard
        </Link>

        {me === null ? (
          <>
            <Link href={href('/login')}>Sign in</Link>
            <Link href={href('/register')} className="font-medium">
              Register
            </Link>
          </>
        ) : (
          <>
            <Link href={href(`/u/${encodeURIComponent(me.username)}`)} data-testid="nav-me">
              @{me.username}
            </Link>
            <Link href={href('/settings')}>Settings</Link>
            <form action={logoutAction.bind(null, locale)}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          </>
        )}
      </nav>
    </header>
  );
}
