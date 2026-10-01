import type { Metadata } from 'next';
import { ActionForm } from '@/components/action-form';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { message, t } from '@/i18n/messages';
import { forgotPasswordAction } from '@/lib/auth-actions';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'auth.forgot.metaTitle')} · FMIP` };
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="auth.login.forgot" />
      </h1>
      <p className="text-sm">
        <Translated locale={locale} message="auth.forgot.lead" />
      </p>
      <ActionForm
        action={forgotPasswordAction.bind(null, locale)}
        fields={[
          {
            name: 'email',
            label: t(lang, 'auth.email'),
            type: 'email',
            required: true,
            autoComplete: 'email',
          },
        ]}
        submitLabel={t(lang, 'auth.forgot.submit')}
        testId="forgot-password-form"
        labels={{
          done: message(lang, 'auth.form.done'),
          working: message(lang, 'auth.form.working'),
        }}
      />
    </main>
  );
}
