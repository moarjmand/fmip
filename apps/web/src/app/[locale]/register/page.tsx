import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { fetchCountries, fetchMe } from '@/lib/api';
import { registerAction } from '@/lib/auth-actions';
import { sessionCookieHeader } from '@/lib/session';

export const metadata: Metadata = { title: 'Register · FMIP' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(`/${locale}/u/${encodeURIComponent(me.username)}`);

  const countries = await fetchCountries();
  const timezones = Intl.supportedValuesOf('timeZone');

  if (countries === null) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">Register</h1>
        {/* Rule 3: an empty country list would look like a form with a bug, so say what happened. */}
        <p role="alert">The service is unreachable right now, so registration is unavailable.</p>
      </main>
    );
  }

  const fields: Field[] = [
    {
      name: 'username',
      label: 'Username',
      required: true,
      autoComplete: 'username',
      hint: '3 to 20 characters: lower-case letters, digits, underscore. Shown on leaderboards.',
      maxLength: 20,
    },
    {
      name: 'display_name',
      label: 'Display name',
      required: true,
      autoComplete: 'name',
      maxLength: 50,
    },
    { name: 'email', label: 'E-mail', type: 'email', required: true, autoComplete: 'email' },
    {
      name: 'password',
      label: 'Password',
      type: 'password',
      required: true,
      autoComplete: 'new-password',
      hint: 'At least 10 characters.',
    },
    {
      name: 'country_id',
      label: 'Country or territory',
      type: 'select',
      required: true,
      options: countries.map((c) => ({ value: c.id, label: c.name })),
    },
    {
      name: 'preferred_language',
      label: 'Language',
      type: 'select',
      options: [{ value: 'en', label: 'English' }],
      defaultValue: 'en',
    },
    {
      name: 'timezone',
      label: 'Time zone',
      type: 'select',
      required: true,
      defaultValue: 'UTC',
      options: ['UTC', ...timezones].map((tz) => ({ value: tz, label: tz })),
    },
    {
      name: 'accept_rules',
      label: 'I accept the platform rules.',
      type: 'checkbox',
      required: true,
    },
  ];

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Register</h1>
      <ActionForm
        action={registerAction.bind(null, locale)}
        fields={fields}
        submitLabel="Create account"
        testId="register-form"
      />
      <p className="text-sm">
        Already a member? <Link href={`/${locale}/login`}>Sign in</Link>.
      </p>
    </main>
  );
}
