import type { Metadata } from 'next';
import { Translated } from '@/components/translated';
import { Button, Notice, type NoticeTone } from '@/components/ui';
import { formatDate } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf } from '@/i18n/locales';
import type { MessageKey } from '@/i18n/messages';
import { fetchPlatformRules, fetchSession } from '@/lib/api';
import { rulesBlocks, rulesVersionNumber } from '@/lib/platform-rules';
import { acceptRulesAction } from '@/lib/rules-actions';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/rules',
    title: 'Platform rules · FMIP',
    description:
      'The rules every member accepts: what FMIP is for, what is not allowed, and how leaving works.',
  });
}

const OUTCOMES: Record<string, { tone: NoticeTone; message: MessageKey }> = {
  accepted: { tone: 'success', message: 'rules.outcome.accepted' },
  newer: { tone: 'warning', message: 'rules.outcome.newer' },
  'signed-out': { tone: 'info', message: 'rules.outcome.signedOut' },
  failed: { tone: 'danger', message: 'rules.outcome.failed' },
};

/**
 * The platform rules in force (T-931, D-113), for anybody. A member with a
 * newer version waiting reads it here and accepts it with the form under the
 * text; the form names the version shown, so a version published while they
 * read is never accepted on their behalf. The text is English, as approved.
 */
export default async function RulesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { locale } = await params;
  const { outcome } = await searchParams;
  const [rules, session] = await Promise.all([
    fetchPlatformRules(),
    fetchSession(await sessionCookieHeader()),
  ]);
  const said = outcome === undefined ? undefined : OUTCOMES[outcome];
  const timeZone = session?.user.timezone ?? 'UTC';
  const day = (iso: string) =>
    formatDate(locale, iso, timeZone, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
        <Translated locale={locale} message="rules.title" />
      </h1>

      {said !== undefined && (
        <Notice tone={said.tone} data-testid="rules-outcome">
          <Translated locale={locale} message={said.message} />
        </Notice>
      )}

      {!rules.ok ? (
        <Notice tone="warning" data-testid="rules-unreachable">
          <Translated locale={locale} message="common.unreachable" />
        </Notice>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="rules-version">
            <Translated locale={locale} message="rules.version" />{' '}
            <span dir={directionOf(DEFAULT_LOCALE)}>{rulesVersionNumber(rules.data.version)}</span>
            {' · '}
            <Translated locale={locale} message="rules.published" /> {day(rules.data.published_at)}
          </p>

          {session !== null && session.rules.pending && (
            <Notice tone="info" data-testid="rules-pending">
              <Translated locale={locale} message="rules.pendingIntro" />
            </Notice>
          )}

          {locale !== DEFAULT_LOCALE && (
            <p className="text-sm text-muted">
              <Translated locale={locale} message="rules.englishOnly" />
            </p>
          )}

          <article
            lang={DEFAULT_LOCALE}
            dir={directionOf(DEFAULT_LOCALE)}
            className="flex flex-col gap-3"
            data-testid="rules-body"
          >
            {rulesBlocks(rules.data.body).map((block, index) =>
              block.kind === 'list' ? (
                <ul key={index} className="list-disc ps-6">
                  {block.items.map((item, at) => (
                    <li key={at}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={index}>{block.text}</p>
              ),
            )}
          </article>

          {session === null ? (
            <p className="text-sm" data-testid="rules-guest">
              <Translated locale={locale} message="rules.guest" />
            </p>
          ) : session.rules.pending ? (
            <form action={acceptRulesAction.bind(null, locale, rules.data.version)}>
              <Button type="submit" variant="primary" data-testid="rules-accept">
                <Translated locale={locale} message="rules.accept" />
              </Button>
            </form>
          ) : (
            session.rules.accepted === rules.data.version && (
              <p className="text-sm" data-testid="rules-accepted">
                <Translated locale={locale} message="rules.acceptedCurrent" />{' '}
                {day(session.rules.accepted_at)}.
              </p>
            )
          )}
        </>
      )}
    </main>
  );
}
