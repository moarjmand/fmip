import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import { fetchMe } from '@/lib/api';
import { loginAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'nav.signIn')} · FMIP` };
}
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
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="nav.signIn" />
      </h1>
      {reset === '1' && (
        <p role="status" className="text-sm">
          <Translated locale={locale} message="auth.login.passwordChanged" />
        </p>
      )}
      <ActionForm
        action={loginAction.bind(null, locale)}
        fields={[
          {
            name: 'identifier',
            label: t(lang, 'auth.login.identifier'),
            required: true,
            autoComplete: 'username',
          },
          {
            name: 'password',
            label: t(lang, 'auth.password'),
            type: 'password',
            required: true,
            autoComplete: 'current-password',
          },
        ]}
        submitLabel={t(lang, 'nav.signIn')}
        testId="login-form"
        labels={{
          done: message(lang, 'auth.form.done'),
          working: message(lang, 'auth.form.working'),
        }}
      />
      <p className="flex flex-wrap gap-4 text-sm">
        <Link href={`/${locale}/forgot-password`}>
          <Translated locale={locale} message="auth.login.forgot" />
        </Link>
        <Link href={`/${locale}/register`}>
          <Translated locale={locale} message="auth.login.register" />
        </Link>
      </p>
    </main>
  );
}
