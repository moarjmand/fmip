import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { Button, Notice, type NoticeTone } from '@/components/ui';
import { formatDate } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/locales';
import { type MessageKey, attribute, t } from '@/i18n/messages';
import { fetchPlatformRules, fetchSession } from '@/lib/api';
import {
  type RulesBlock,
  type RulesSection,
  hasPlainWords,
  rulesBlocks,
  rulesSections,
  rulesVersionNumber,
} from '@/lib/platform-rules';
import { acceptRulesAction } from '@/lib/rules-actions';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/rules',
    title: `${t(lang, 'rules.title')} · Stadiomind`,
    description: t(lang, 'rulesPage.meta.description'),
  });
}

const OUTCOMES: Record<string, { tone: NoticeTone; message: MessageKey }> = {
  accepted: { tone: 'success', message: 'rules.outcome.accepted' },
  newer: { tone: 'warning', message: 'rules.outcome.newer' },
  'signed-out': { tone: 'info', message: 'rules.outcome.signedOut' },
  failed: { tone: 'danger', message: 'rules.outcome.failed' },
};

/**
 * How long records are kept (T-1715, D-345), under the rules rather than in
 * them: it is a notice, not a version a member accepts, and it is translated.
 * The periods are `RETENTION_DAYS` in the API's retention module and the
 * backups' `BACKUP_KEEP_REMOTE_DAYS` default; change them together.
 */
const RETENTION_LINES: MessageKey[] = [
  'rules.retention.sessions',
  'rules.retention.emailLinks',
  'rules.retention.notifications',
  // A pick saved before the email address was confirmed (T-1740, D-361).
  'rules.retention.pendingPicks',
  'rules.retention.backups',
];

/** The three things not allowed, in plain words (T-1969): the rule, what it is, an example. */
const PLAIN_RULES: readonly { name: MessageKey; body: MessageKey; example: MessageKey }[] = [
  {
    name: 'rules.plain.spam.name',
    body: 'rules.plain.spam.body',
    example: 'rules.plain.spam.example',
  },
  {
    name: 'rules.plain.abuse.name',
    body: 'rules.plain.abuse.body',
    example: 'rules.plain.abuse.example',
  },
  {
    name: 'rules.plain.impersonation.name',
    body: 'rules.plain.impersonation.body',
    example: 'rules.plain.impersonation.example',
  },
];

/** The plain words after the three rules, each a heading and a paragraph. */
const PLAIN_PARTS: readonly { heading: MessageKey; body: MessageKey }[] = [
  { heading: 'rules.plain.rating.title', body: 'rules.plain.rating.body' },
  { heading: 'rules.plain.report.title', body: 'rules.plain.report.body' },
  { heading: 'rules.plain.after.title', body: 'rules.plain.after.body' },
  { heading: 'rules.plain.appeal.title', body: 'rules.plain.appeal.body' },
  { heading: 'rules.plain.leave.title', body: 'rules.plain.leave.body' },
  { heading: 'rules.plain.changes.title', body: 'rules.plain.changes.body' },
];

function PlainPart({
  locale,
  heading,
  children,
}: {
  locale: string;
  heading: MessageKey;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">
        <Translated locale={locale} message={heading} />
      </h3>
      {children}
    </div>
  );
}

/**
 * The community rules in plain words (T-1969, D-459), above the text they
 * explain, so the rules have one place and the sign-up form's link and the
 * footer's lead to both. Written from the content-community draft of
 * 2026-11-27 with a line of `docs/13-policy.md` behind every sentence:
 * exactly the text's three rules, and where to report and to appeal named as
 * the controls are (T-1973). English and Persian; every other language is
 * the English, marked, like any untranslated string. Not part of a version:
 * the member accepts the text under it, and it is shown only beside a
 * version it was written for (`hasPlainWords`).
 */
function PlainWords({ locale }: { locale: string }) {
  return (
    <section
      id="in-plain-words"
      aria-labelledby="in-plain-words-heading"
      className="flex flex-col gap-5 rounded-card border border-default bg-surface p-4 sm:p-6"
      data-testid="rules-plain"
    >
      <h2 id="in-plain-words-heading" className="text-xl font-semibold">
        <Translated locale={locale} message="rules.plain.title" />
      </h2>
      <p>
        <Translated locale={locale} message="rules.plain.intro" />
      </p>
      <PlainPart locale={locale} heading="rules.plain.for.title">
        <p>
          <Translated locale={locale} message="rules.plain.for.body" />
        </p>
      </PlainPart>
      <PlainPart locale={locale} heading="rules.plain.notAllowed.title">
        <ul className="flex list-disc flex-col gap-3 ps-6" data-testid="rules-plain-not-allowed">
          {PLAIN_RULES.map((rule) => (
            <li key={rule.name}>
              <strong className="font-semibold">
                <Translated locale={locale} message={rule.name} />
              </strong>{' '}
              <Translated locale={locale} message={rule.body} />
              <p className="text-sm text-muted">
                <Translated locale={locale} message={rule.example} />
              </p>
            </li>
          ))}
        </ul>
        <p>
          <Translated locale={locale} message="rules.plain.arguing" />
        </p>
      </PlainPart>
      {PLAIN_PARTS.map((part) => (
        <PlainPart key={part.heading} locale={locale} heading={part.heading}>
          <p>
            <Translated locale={locale} message={part.body} />
          </p>
        </PlainPart>
      ))}
    </section>
  );
}

/** A block of the rules text: a paragraph, or a list. */
function Block({ block }: { block: RulesBlock }) {
  return block.kind === 'list' ? (
    <ul className="list-disc ps-6">
      {block.items.map((item, at) => (
        <li key={at}>{item}</li>
      ))}
    </ul>
  ) : (
    <p>{block.text}</p>
  );
}

/**
 * The index of the sections (T-1789, D-410): a link to each heading, a 44px
 * row. The headings are the text's own English words, so the list is
 * English and left to right on every page, like the text.
 */
function SectionLinks({ sections }: { sections: RulesSection[] }) {
  return (
    <ol lang={DEFAULT_LOCALE} dir={directionOf(DEFAULT_LOCALE)} className="flex flex-col">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex min-h-touch items-center gap-3 text-sm text-muted hover:text-fg hover:underline"
          >
            <span className="w-4 shrink-0 text-end font-mono text-xs text-caption">
              {index + 1}
            </span>
            {section.heading}
          </a>
        </li>
      ))}
    </ol>
  );
}

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
  const { timeZone } = await pageTimeZone(locale, session?.user ?? null);
  const day = (iso: string) =>
    formatDate(locale, iso, timeZone, { day: 'numeric', month: 'long', year: 'numeric' });
  // Numbered sections with an index, only for a version whose headings were
  // checked against its text (T-1789, D-410); any other is plain blocks.
  const sections = rules.ok ? rulesSections(rules.data.version, rules.data.body) : null;
  const plain = rules.ok && hasPlainWords(rules.data.version);
  const onThisPage = attribute(
    isLocale(locale) ? locale : DEFAULT_LOCALE,
    'matchCentre.onThisPage',
  );

  return (
    // The title and the plain words in the first row, the text and its index
    // in the second (T-1969): from 1024px the index stands beside the text it
    // leads through, not beside the plain words.
    <main
      className={`mx-auto flex max-w-3xl flex-col gap-6 p-8 ${sections === null ? '' : 'lg:grid lg:max-w-5xl lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-8'}`}
    >
      <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
        <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
          <Translated locale={locale} message="rules.title" />
        </h1>

        {said !== undefined && (
          <Notice tone={said.tone} data-testid="rules-outcome">
            <Translated locale={locale} message={said.message} />
          </Notice>
        )}

        {plain && <PlainWords locale={locale} />}
      </div>

      <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-2">
        {!rules.ok ? (
          <Notice tone="warning" data-testid="rules-unreachable">
            <Translated locale={locale} message="common.unreachable" />
          </Notice>
        ) : (
          <>
            <p className="text-sm text-muted" data-testid="rules-version">
              <Translated locale={locale} message="rules.version" />{' '}
              <span dir={directionOf(DEFAULT_LOCALE)}>
                {rulesVersionNumber(rules.data.version)}
              </span>
              {' · '}
              <Translated locale={locale} message="rules.published" />{' '}
              {day(rules.data.published_at)}
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

            {sections !== null && (
              // A closed native list on a phone and a tablet: one 48px line
              // until it is opened (no script).
              <nav aria-label={onThisPage.text} lang={onThisPage.lang} className="lg:hidden">
                <details
                  className="rounded-card border border-default bg-surface px-4"
                  data-testid="rules-index-phone"
                >
                  <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">
                    <Translated locale={locale} message="matchCentre.onThisPage" />
                  </summary>
                  <div className="pb-2">
                    <SectionLinks sections={sections} />
                  </div>
                </details>
              </nav>
            )}

            <article
              lang={DEFAULT_LOCALE}
              dir={directionOf(DEFAULT_LOCALE)}
              className="flex flex-col gap-3"
              data-testid="rules-body"
            >
              {sections === null
                ? rulesBlocks(rules.data.body).map((block, index) => (
                    <Block key={index} block={block} />
                  ))
                : sections.map((section, index) => (
                    <section
                      key={section.id}
                      id={section.id}
                      aria-labelledby={`${section.id}-heading`}
                      className="flex flex-col gap-3 pt-3"
                      data-testid={`rules-section-${section.id}`}
                    >
                      <h2 id={`${section.id}-heading`} className="flex gap-3 text-lg font-semibold">
                        <span className="font-mono text-caption">{index + 1}</span>
                        {section.heading}
                      </h2>
                      {section.blocks.map((block, at) => (
                        <Block key={at} block={block} />
                      ))}
                    </section>
                  ))}
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

        <section
          aria-labelledby="retention-heading"
          className="flex flex-col gap-2 border-t border-default pt-6"
          data-testid="rules-retention"
        >
          <h2 id="retention-heading" className="text-lg font-semibold">
            <Translated locale={locale} message="rules.retention.heading" />
          </h2>
          <p>
            <Translated locale={locale} message="rules.retention.lead" />
          </p>
          <ul className="list-disc ps-6">
            {RETENTION_LINES.map((message) => (
              <li key={message}>
                <Translated locale={locale} message={message} />
              </li>
            ))}
          </ul>
        </section>
      </div>
      {sections !== null && (
        // Beside the text from 1024px, under the header as the page scrolls;
        // after the text in reading order, so the page's h1 is read first;
        // no "you are here" marker, which would need a script.
        <nav
          aria-label={onThisPage.text}
          lang={onThisPage.lang}
          className="hidden lg:col-start-1 lg:row-start-2 lg:sticky lg:top-[calc(var(--site-header-height)+2rem)] lg:block lg:self-start"
          data-testid="rules-index"
        >
          <h2 className="pb-1 text-xs font-bold tracking-wide text-caption uppercase">
            <Translated locale={locale} message="matchCentre.onThisPage" />
          </h2>
          <SectionLinks sections={sections} />
        </nav>
      )}
    </main>
  );
}
