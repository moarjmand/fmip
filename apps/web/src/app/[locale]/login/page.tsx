import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { redirect } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import { fetchMe } from '@/lib/api';
import { loginAction } from '@/lib/auth-actions';
import { RETURN_PARAM, registerHref, safeReturnPath } from '@/lib/return-to';
import { sessionCookieHeader } from '@/lib/session';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'nav.signIn')} · Stadiomind` };
}
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string; next?: string | string[] }>;
}) {
  const { locale } = await params;
  const { reset, next: asked } = await searchParams;
  // Where the reader was going (T-1736, D-358): a path of ours under this
  // locale, or nothing. It rides the form and the link to the register page.
  const next = safeReturnPath(locale, asked);
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(next ?? `/${locale}/u/${encodeURIComponent(me.username)}`);
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  // A hidden field: its label is never shown.
  const returning: Field[] =
    next === null
      ? []
      : [{ name: RETURN_PARAM, label: 'Return to', type: 'hidden', defaultValue: next }];

  return (
    // `data-no-rail`: no moments rail on this page (T-1755, D-372; globals.css).
    <main data-no-rail="" className="mx-auto flex max-w-md flex-col gap-6 p-8">
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
          ...returning,
          {
            name: 'identifier',
            label: t(lang, 'auth.login.identifier'),
            required: true,
            autoComplete: 'username',
            // A username or an e-mail address: Latin either way (T-1737, D-358).
            latin: true,
            enterKeyHint: 'next',
          },
          {
            name: 'password',
            label: t(lang, 'auth.password'),
            type: 'password',
            required: true,
            autoComplete: 'current-password',
            latin: true,
            enterKeyHint: 'go',
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
        <Link href={registerHref(locale, next)} data-testid="login-register">
          <Translated locale={locale} message="auth.login.register" />
        </Link>
      </p>
    </main>
  );
}
