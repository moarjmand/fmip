import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from '@/components/ui/link';
import { buttonClasses, Notice } from '@/components/ui';
import { ShareCardButton } from '@/components/share-card-button';
import { Translated } from '@/components/translated';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';
import { fetchOwnPredictionShare } from '@/lib/api';
import { createShareAction, revokeShareAction } from '@/lib/prediction-share-actions';
import { siteUrl } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    title: `${t(resolved, 'shareCard.title')} · Stadiomind`,
    robots: { index: false, follow: false },
  };
}

const NOT_CALLED: Record<'open' | 'void' | 'wrong', MessageKey> = {
  open: 'shareCard.notCalled.open',
  void: 'shareCard.notCalled.void',
  wrong: 'shareCard.notCalled.wrong',
};

const SAID: Partial<Record<string, { key: MessageKey; tone: 'success' | 'danger' | 'info' }>> = {
  made: { key: 'shareCard.made', tone: 'success' },
  stopped: { key: 'shareCard.stopped', tone: 'info' },
  rate_limited: { key: 'shareCard.rateLimited', tone: 'danger' },
  not_called: { key: 'shareCard.notCalled.wrong', tone: 'danger' },
  failed: { key: 'shareCard.failed', tone: 'danger' },
};

/**
 * A member's own card for one correct pick (T-1723, D-351; B06's flow), where
 * the notification after full time opens.
 *
 * **Nothing here is public until its owner says so.** The preview is drawn
 * for them alone (`preview`, behind their session). "Create the share link"
 * is the consent: it makes one public link to this one card, and the page
 * then offers the phone's share sheet with the picture, a saved picture, and
 * "Stop sharing", which withdraws it. Their other predictions and their
 * profile's settings are untouched. The forms work without JavaScript; only
 * the share sheet needs it, and it is on this route alone.
 */
export default async function PredictionSharePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ share?: string | string[] }>;
}) {
  const { locale, id } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const here = `/${locale}/predictions/${encodeURIComponent(id)}/share`;
  const cookie = await sessionCookieHeader();
  if (cookie === undefined) redirect(`/${locale}/login?next=${here}`);

  const result = await fetchOwnPredictionShare(id, cookie);
  if (!result.ok) {
    if (result.status === 401) redirect(`/${locale}/login?next=${here}`);
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="shareCard.title" />
        </h1>
        <Notice tone="danger" data-testid="share-card-unreachable">
          <Translated locale={locale} message="shareCard.unreachable" />
        </Notice>
      </main>
    );
  }

  const back = (
    <Link href={`/${locale}/predictions`} className="underline">
      <Translated locale={locale} message="shareCard.back" />
    </Link>
  );

  if (result.data.kind === 'not_called') {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="shareCard.title" />
        </h1>
        <p data-testid="share-card-none">
          <Translated locale={locale} message={NOT_CALLED[result.data.reason]} />
        </p>
        <p>{back}</p>
      </main>
    );
  }

  const { card, share } = result.data;
  const said = SAID[[(await searchParams).share].flat()[0] ?? ''];
  const create = createShareAction.bind(null, locale, id);
  const revoke = revokeShareAction.bind(null, locale, id);
  const publicPath = share === null ? null : `/${locale}/called-it/${share.token}`;
  const publicUrl = publicPath === null ? null : `${siteUrl()}${publicPath}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="shareCard.calledIt" />
      </h1>
      {said !== undefined && (
        <Notice tone={said.tone} data-testid="share-card-said">
          <Translated locale={locale} message={said.key} />
        </Notice>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- a drawn PNG of fixed size, not a photo to optimise */}
      <img
        src={publicPath === null ? `${here}/preview` : `${publicPath}/card`}
        width={1200}
        height={630}
        alt={t(resolved, 'shareCard.previewAlt')}
        className="h-auto w-full rounded-card border border-default"
        data-testid="share-card-preview"
      />
      <p className="text-sm text-muted" data-testid="share-card-privacy">
        <Translated locale={locale} message="shareCard.privacy" />
      </p>

      {share === null || publicUrl === null || publicPath === null ? (
        <form action={create}>
          <button
            type="submit"
            className={buttonClasses({ variant: 'primary' })}
            data-testid="share-card-create"
          >
            <Translated locale={locale} message="shareCard.create" />
          </button>
        </form>
      ) : (
        <section className="flex flex-col gap-3" data-testid="share-card-live">
          <p className="flex flex-col gap-1 text-sm">
            <span className="text-muted">
              <Translated locale={locale} message="shareCard.link" />
            </span>
            <a href={publicPath} className="break-all underline" data-testid="share-card-link">
              {publicUrl}
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ShareCardButton
              url={publicUrl}
              imageUrl={`${publicPath}/card`}
              title={`@${card.username} · Stadiomind`}
              labels={{
                share: t(resolved, 'shareCard.share'),
                copied: t(resolved, 'share.copied'),
                manual: t(resolved, 'share.manual'),
              }}
            />
            <a
              href={`${publicPath}/card`}
              download="stadiomind-called-it.png"
              className={buttonClasses({ variant: 'secondary' })}
            >
              <Translated locale={locale} message="shareCard.save" />
            </a>
            <a
              href={`${publicPath}/story`}
              download="stadiomind-called-it-story.png"
              className={buttonClasses({ variant: 'secondary' })}
            >
              <Translated locale={locale} message="shareCard.saveStory" />
            </a>
          </div>
          <form action={revoke}>
            <button
              type="submit"
              className={buttonClasses({ variant: 'ghost' })}
              data-testid="share-card-stop"
            >
              <Translated locale={locale} message="shareCard.stop" />
            </button>
          </form>
        </section>
      )}

      <p className="flex flex-wrap gap-4 text-sm">
        <Link href={`/${locale}/match/${card.fixture_id}`} className="underline">
          <Translated locale={locale} message="shareCard.openMatch" />
        </Link>
        {back}
      </p>
    </main>
  );
}
