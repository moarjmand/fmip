import type { Metadata } from 'next';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
import { readerAddress } from '@/lib/session';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { t } from '@/i18n/messages';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return { title: `${t(lang, 'auth.verify.metaTitle')} · FMIP` };
}
export const dynamic = 'force-dynamic';

/**
 * The link from the verification e-mail lands here. The token is spent on
 * this render: it is single-use in the database, so a second visit, a
 * refresh, or a link-previewing mail client gets the "already used" answer
 * rather than a second success.
 */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;

  const result =
    token === undefined || token === ''
      ? null
      : await apiRequest<{ verified: true }>('/auth/verify-email', {
          method: 'POST',
          body: { token },
          clientIp: await readerAddress(),
        });

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="auth.verify.title" />
      </h1>
      {result === null ? (
        <Notice tone="warning">
          <Translated locale={locale} message="auth.needsLink" />
        </Notice>
      ) : result.ok ? (
        <p role="status" data-testid="verify-result">
          <Translated locale={locale} message="auth.verify.done" />
        </p>
      ) : result.status === 0 ? (
        <Notice tone="danger">
          <Translated locale={locale} message="auth.verify.unreachable" />
        </Notice>
      ) : (
        <Notice tone="danger" data-testid="verify-result">
          {/* The API's own reason when it gives one, as it wrote it. */}
          {result.error?.message ?? <Translated locale={locale} message="auth.verify.invalid" />}
        </Notice>
      )}
      <p className="text-sm">
        <Link href={`/${locale}`}>
          <Translated locale={locale} message="auth.verify.back" />
        </Link>
      </p>
    </main>
  );
}
