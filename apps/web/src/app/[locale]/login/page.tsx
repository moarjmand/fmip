import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { fetchMe } from '@/lib/api';
import { loginAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in · FMIP' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string }>;
}) {
  const { locale } = await params;
  const { reset } = await searchParams;
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(`/${locale}/u/${encodeURIComponent(me.username)}`);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {reset === '1' && (
        <p role="status" className="text-sm">
          Your password was changed and every other session was signed out. Sign in with the new
          one.
        </p>
      )}
      <ActionForm
        action={loginAction.bind(null, locale)}
        fields={[
          {
            name: 'identifier',
            label: 'Username or e-mail',
            required: true,
            autoComplete: 'username',
          },
          {
            name: 'password',
            label: 'Password',
            type: 'password',
            required: true,
            autoComplete: 'current-password',
          },
        ]}
        submitLabel="Sign in"
        testId="login-form"
      />
      <p className="flex flex-wrap gap-4 text-sm">
        <Link href={`/${locale}/forgot-password`}>Forgot your password?</Link>
        <Link href={`/${locale}/register`}>Create an account</Link>
      </p>
    </main>
  );
}
