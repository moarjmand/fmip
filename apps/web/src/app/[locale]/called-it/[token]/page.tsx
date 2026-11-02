import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from '@/components/ui/link';
import { buttonClasses, Notice } from '@/components/ui';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { fetchPredictionShare } from '@/lib/api';
import { siteUrl } from '@/lib/seo';
import { calledItText, CARD_SIZE } from '@/lib/share-card';

export const dynamic = 'force-dynamic';

/**
 * The page a shared "called it" link opens (T-1723, D-351): the card, what it
 * says in the reader's language, the match, and a way in. Rendered from the
 * token alone -- no session is read or sent -- so it shows the same to
 * everyone and nothing beyond the one card its owner chose to publish. A
 * token that is unknown, revoked or no longer a correct pick is a 404, the
 * same answer for each. Never indexed: a member published a link, not a page
 * for search engines, and the token never travels onward in a `Referer`.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { locale, token } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const result = await fetchPredictionShare(token);
  if (!result.ok) return { robots: { index: false, follow: false }, referrer: 'no-referrer' };
  const handle = `@${result.data.card.username}`;
  const title = interpolate(t(resolved, 'calledIt.title'), { handle });
  const image = {
    url: `${siteUrl()}/${locale}/called-it/${encodeURIComponent(token)}/card`,
    ...CARD_SIZE,
    alt: t(resolved, 'calledIt.alt'),
  };
  return {
    title: `${title} · Stadiomind`,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    openGraph: { title, images: [image] },
    twitter: { card: 'summary_large_image', title, images: [image] },
  };
}

export default async function CalledItPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const result = await fetchPredictionShare(token);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <Notice tone="danger" data-testid="called-it-unreachable">
          <Translated locale={locale} message="shareCard.unreachable" />
        </Notice>
      </main>
    );
  }

  const { card } = result.data;
  const text = calledItText(card);
  const base = `/${locale}/called-it/${encodeURIComponent(token)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <h1 className="text-2xl font-semibold" data-testid="called-it-title">
        <FilledMessage
          message={message(resolved, 'calledIt.title')}
          params={{ handle: text.handle }}
        />
      </h1>
      {/* eslint-disable-next-line @next/next/no-img-element -- a drawn PNG of fixed size, not a photo to optimise */}
      <img
        src={`${base}/card`}
        width={CARD_SIZE.width}
        height={CARD_SIZE.height}
        alt={t(resolved, 'calledIt.alt')}
        className="h-auto w-full rounded-card border border-default"
        data-testid="called-it-card"
      />
      <p data-testid="called-it-summary">
        <FilledMessage
          message={message(resolved, 'calledIt.summary')}
          params={{ handle: text.handle }}
        />
      </p>
      <p className="flex flex-wrap items-center gap-4">
        <Link href={`/${locale}/match/${card.fixture_id}`} className="underline">
          <Translated locale={locale} message="shareCard.openMatch" />
        </Link>
        <Link href={`/${locale}/scores`} className={buttonClasses({ variant: 'primary' })}>
          <Translated locale={locale} message="calledIt.cta" />
        </Link>
      </p>
    </main>
  );
}
