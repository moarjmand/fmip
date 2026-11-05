import type { Metadata } from 'next';
import Link from '@/components/ui/link';
import { redirect } from 'next/navigation';
import { ActionForm, type Field } from '@/components/action-form';
import { DeviceTimeZone } from '@/components/device-time-zone';
import { PasswordReveal, ZoneLine } from '@/components/register-controls';
import { fetchCountries, fetchMe } from '@/lib/api';
import { readGuestChoices } from '@/lib/first-run-cookie';
import { readInviter } from '@/lib/invite';
import { registerAction } from '@/lib/auth-actions';
import { RETURN_PARAM, loginHref, safeReturnPath } from '@/lib/return-to';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';
import { Icon, Notice } from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { type MessageKey, interpolate, message, t } from '@/i18n/messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'auth.register.title')} · Stadiomind` };
}
export const dynamic = 'force-dynamic';

/** What an account gives, in three short points under the title (T-1737, D-358). */
const POINTS: readonly MessageKey[] = [
  'auth.register.point.pick',
  'auth.register.point.rating',
  'auth.register.point.follow',
];

/** A catalogue sentence with one `{name}` in it, as the words before and after it. */
function around(sentence: string, name: string): [string, string] {
  const [before = '', after = ''] = sentence.split(`{${name}}`);
  return [before, after];
}

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
  // Where the reader was going (T-1736, D-358): the new account lands there
  // after the first run. A path of ours under this locale, or nothing.
  const next = safeReturnPath(locale, query[RETURN_PARAM]);
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(next ?? `/${locale}/u/${encodeURIComponent(me.username)}`);

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

  const [zoneBefore, zoneAfter] = around(t(lang, 'auth.register.timezoneLine'), 'zone');
  const [rulesBefore, rulesAfter] = around(t(lang, 'auth.register.acceptRules'), 'rules');

  // The form asks for what only the reader knows (T-1737, D-358). The display
  // name is the username until they change it in Settings and the language is
  // this page's; `registerAction` supplies both, so registration still stores
  // them (blueprint 7.1).
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
    ...(next === null
      ? []
      : [
          {
            name: RETURN_PARAM,
            // A hidden field: its label is never shown.
            label: 'Return to',
            type: 'hidden' as const,
            defaultValue: next,
          },
        ]),
    {
      name: 'username',
      label: t(lang, 'auth.username'),
      required: true,
      autoComplete: 'username',
      hint: t(lang, 'auth.register.usernameHint'),
      maxLength: 20,
      latin: true,
      enterKeyHint: 'next',
    },
    {
      name: 'email',
      label: t(lang, 'auth.email'),
      type: 'email',
      required: true,
      autoComplete: 'email',
      latin: true,
      inputMode: 'email',
      enterKeyHint: 'next',
    },
    {
      name: 'password',
      label: t(lang, 'auth.password'),
      type: 'password',
      required: true,
      autoComplete: 'new-password',
      hint: t(lang, 'auth.passwordHint'),
      // The API's own rule decides; this only tells a password manager.
      minLength: 10,
      latin: true,
      enterKeyHint: 'next',
      // Show and Hide, beside the field: the form's one control with state.
      after: (
        <PasswordReveal
          show={t(lang, 'auth.passwordShow')}
          hide={t(lang, 'auth.passwordHide')}
          field={t(lang, 'auth.password')}
        />
      ),
    },
    {
      name: 'country_id',
      label: t(lang, 'auth.register.country'),
      type: 'select',
      required: true,
      // What the product does with it, and no more (D-358 §8).
      hint: t(lang, 'auth.register.countryWhy'),
      // No country is preselected (T-1480): the list opened on its first
      // entry, so a reader who did not look registered in Afghanistan.
      defaultValue: '',
      options: [
        { value: '', label: t(lang, 'auth.register.countryChoose') },
        ...countries.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      name: 'timezone',
      label: t(lang, 'auth.register.timezone'),
      type: 'select',
      required: true,
      defaultValue: guest.timezone ?? 'UTC',
      options: ['UTC', ...timezones].map((tz) => ({ value: tz, label: tz })),
      // One line, "Time zone: <zone> · Change", with the list behind Change.
      summary: (
        <ZoneLine
          before={zoneBefore}
          after={zoneAfter}
          change={t(lang, 'auth.register.timezoneChange')}
          initial={guest.timezone ?? 'UTC'}
        />
      ),
    },
    {
      name: 'accept_rules',
      // What the checkbox accepts is one tap away, inside its own label (T-931).
      label: (
        <span>
          {rulesBefore}
          <Link href={`/${locale}/rules`} className="underline" data-testid="register-rules-link">
            {t(lang, 'auth.register.rulesLink')}
          </Link>
          {rulesAfter}
        </span>
      ),
      type: 'checkbox',
      required: true,
      touch: true,
    },
  ];

  return (
    // `data-page`: the header does not draw its own Create account here (globals.css).
    <main
      data-page="register"
      className="mx-auto grid w-full max-w-5xl gap-6 p-4 sm:p-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,31rem)] lg:justify-center lg:gap-16 lg:py-12"
    >
      <div className="flex flex-col gap-3 lg:pt-4">
        <h1 className="text-2xl font-extrabold font-stretch-semi-expanded lg:text-3xl">
          <Translated locale={locale} message="auth.register.title" />
        </h1>
        <p className="text-sm text-muted lg:text-base">
          <Translated locale={locale} message="auth.register.lead" />
        </p>
        <ul className="flex flex-col gap-2 text-sm lg:text-base" data-testid="register-points">
          {POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Icon name="check" className="text-accent" />
              <Translated locale={locale} message={point} />
            </li>
          ))}
        </ul>
        {inviter !== null && (
          <p data-testid="invited-by">
            {interpolate(t(lang, 'auth.register.invited'), { username: inviter })}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-4 rounded-card border border-default bg-surface p-4 sm:p-6">
        <ActionForm
          action={registerAction.bind(null, locale)}
          fields={fields}
          submitLabel={t(lang, 'auth.register.submit')}
          testId="register-form"
          labels={{
            done: message(lang, 'auth.form.done'),
            working: message(lang, 'auth.form.working'),
          }}
          wideSubmit
          footnote={
            <p className="text-sm text-muted" data-testid="register-email-use">
              <Translated locale={locale} message="auth.register.emailUse" />
            </p>
          }
        />
        {/* A zone the guest confirmed stands; otherwise this device's own replaces UTC. */}
        {guest.timezone === undefined && (
          <DeviceTimeZone form="register-form" field="timezone" unless="UTC" />
        )}
        <p className="text-sm">
          <Translated locale={locale} message="auth.register.already" />{' '}
          <Link href={loginHref(locale, next)} className="underline" data-testid="register-sign-in">
            <Translated locale={locale} message="nav.signIn" />
          </Link>
        </p>
      </div>
    </main>
  );
}
