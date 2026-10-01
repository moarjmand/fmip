import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { fetchCountries, fetchMe } from '@/lib/api';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { readInviter } from '@/lib/invite';
import { registerAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'auth.register.title')} · FMIP` };
}
export const dynamic = 'force-dynamic';

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  // A member's invite link names them (T-522); anything else is ignored.
  const inviter = readInviter(query.invited_by);
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(`/${locale}/u/${encodeURIComponent(me.username)}`);

  const countries = await fetchCountries();
  const timezones = Intl.supportedValuesOf('timeZone');
  // The zone a guest confirmed in the first run (T-620) is this form's default.
  const guest = await readGuestChoices();

  if (countries === null) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="auth.register.title" />
        </h1>
        {/* Rule 3: an empty country list would look like a form with a bug, so say what happened. */}
        <Notice tone="danger">
          <Translated locale={locale} message="auth.register.unreachable" />
        </Notice>
      </main>
    );
  }

  if (countries.length === 0) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="auth.register.title" />
        </h1>
        {/* A required list with nothing in it is a form nobody can submit (D-078). */}
        <Notice tone="warning">
          <Translated locale={locale} message="auth.register.closed" />
        </Notice>
      </main>
    );
  }

  const fields: Field[] = [
    ...(inviter === null
      ? []
      : [
          {
            name: 'invited_by',
            // A hidden field: its label is never shown.
            label: 'Invited by',
            type: 'hidden' as const,
            defaultValue: inviter,
          },
        ]),
    {
      name: 'username',
      label: t(lang, 'auth.username'),
      required: true,
      autoComplete: 'username',
      hint: t(lang, 'auth.register.usernameHint'),
      maxLength: 20,
    },
    {
      name: 'display_name',
      label: t(lang, 'auth.displayName'),
      required: true,
      autoComplete: 'name',
      maxLength: 50,
    },
    {
      name: 'email',
      label: t(lang, 'auth.email'),
      type: 'email',
      required: true,
      autoComplete: 'email',
    },
    {
      name: 'password',
      label: t(lang, 'auth.password'),
      type: 'password',
      required: true,
      autoComplete: 'new-password',
      hint: t(lang, 'auth.passwordHint'),
    },
    {
      name: 'country_id',
      label: t(lang, 'auth.register.country'),
      type: 'select',
      required: true,
      options: countries.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: 'preferred_language',
      label: t(lang, 'auth.register.language'),
      type: 'select',
      options: [{ value: 'en', label: t(lang, 'language.name.en') }],
      defaultValue: 'en',
    },
    {
      name: 'timezone',
      label: t(lang, 'auth.register.timezone'),
      type: 'select',
      required: true,
      defaultValue: guest.timezone ?? 'UTC',
      options: ['UTC', ...timezones].map((tz) => ({ value: tz, label: tz })),
    },
    {
      name: 'accept_rules',
      label: t(lang, 'auth.register.acceptRules'),
      type: 'checkbox',
      required: true,
    },
  ];

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="auth.register.title" />
      </h1>
      {inviter !== null && (
        <p data-testid="invited-by">
          {interpolate(t(lang, 'auth.register.invited'), { username: inviter })}
        </p>
      )}
      {/* What the checkbox accepts, readable before it is ticked (T-931). */}
      <p className="text-sm">
        <Link href={`/${locale}/rules`} data-testid="register-rules-link">
          <Translated locale={locale} message="rules.registerLink" />
        </Link>
      </p>
      <ActionForm
        action={registerAction.bind(null, locale)}
        fields={fields}
        submitLabel={t(lang, 'auth.register.submit')}
        testId="register-form"
        labels={{
          done: message(lang, 'auth.form.done'),
          working: message(lang, 'auth.form.working'),
        }}
      />
      <p className="text-sm">
        <Translated locale={locale} message="auth.register.already" />{' '}
        <Link href={`/${locale}/login`}>
          <Translated locale={locale} message="nav.signIn" />
        </Link>
        .
      </p>
    </main>
  );
}
