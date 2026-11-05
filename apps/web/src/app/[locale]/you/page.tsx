import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GateCard } from '@/components/gate-card';
import { Translated } from '@/components/translated';
import Link from '@/components/ui/link';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import { fetchMe } from '@/lib/api';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/you',
    title: `${t(resolved, 'shell.tab.you')} · Stadiomind`,
    description: t(resolved, 'gate.you'),
    index: false,
  });
}

/**
 * Where the phone's You tab leads a guest (T-1736, D-358): one sentence on
 * what an account gives, then Create account and Sign in, in that order, in
 * place of a bare sign-in form. The gate carries no return address: the tab
 * has no page of its own to come back to. A member has no use for the page
 * and goes to Settings, where their tab already leads.
 */
export default async function YouPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const me = await fetchMe(await sessionCookieHeader());
  if (me !== null) redirect(`/${locale}/settings`);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 sm:px-8 sm:py-14">
      <GateCard
        locale={locale}
        route="/you"
        eyebrow={<Translated locale={locale} message="shell.tab.you" />}
      />
      {/* What a guest keeps without an account, and where (T-621). */}
      <p className="flex flex-wrap items-center gap-x-2 px-1 text-sm text-muted">
        <Translated locale={locale} message="gate.you.settings" />
        <Link
          href={`/${locale}/settings`}
          className="inline-flex min-h-touch items-center underline"
          data-testid="you-settings"
        >
          <Translated locale={locale} message="nav.settings" />
        </Link>
      </p>
    </main>
  );
}
