import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import { resetPasswordAction } from '@/lib/auth-actions';
import { Notice } from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'auth.reset.title')} · FMIP` };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;

  if (token === undefined || token === '') {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="auth.reset.title" />
        </h1>
        <Notice tone="warning">
          <Translated locale={locale} message="auth.needsLink" />{' '}
          <Link href={`/${locale}/forgot-password`}>
            <Translated locale={locale} message="auth.reset.requestNew" />
          </Link>
          .
        </Notice>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="auth.reset.heading" />
      </h1>
      <p className="text-sm">
        <Translated locale={locale} message="auth.reset.lead" />
      </p>
      <ActionForm
        action={resetPasswordAction.bind(null, locale)}
        fields={[
          { name: 'token', type: 'hidden', label: '', defaultValue: token },
          {
            name: 'password',
            label: t(lang, 'auth.reset.newPassword'),
            type: 'password',
            required: true,
            autoComplete: 'new-password',
            hint: t(lang, 'auth.passwordHint'),
          },
        ]}
        submitLabel={t(lang, 'auth.reset.submit')}
        testId="reset-password-form"
        labels={{
          done: message(lang, 'auth.form.done'),
          working: message(lang, 'auth.form.working'),
        }}
      />
    </main>
  );
}
