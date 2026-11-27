import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { formatDate, localDigits } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale } from '@/i18n/locales';
import { attribute, t } from '@/i18n/messages';
import { PRIVACY_NOTICE, PRIVACY_PATH, privacyController } from '@/lib/privacy-notice';
import { pageMetadata, siteUrl } from '@/lib/seo';
import { NoticeText } from './notice-text';
import {
  NOTICE_SECTIONS,
  type NoticeBlock,
  type NoticePart,
  type NoticeRow,
} from './privacy-sections';

export const dynamic = 'force-dynamic';

/**
 * Never indexed during the private trial (T-1953's condition 3): `noindex`
 * here, `X-Robots-Tag` from the proxy, and no line in the sitemap. Still a
 * title, a description, a canonical and the language alternates, like every
 * page (T-039).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: PRIVACY_PATH,
    title: `${t(lang, 'privacy.title')} · Stadiomind`,
    description: t(lang, 'privacy.meta.description'),
    index: false,
  });
}

/** Where to complain to the ICO, from the draft's section 10. */
const ICO_COMPLAINTS = 'https://ico.org.uk/make-a-complaint/';
const ICO_PHONE = '0303 123 1113';

type Values = Readonly<Record<string, ReactNode>>;

/** A row of a table of the draft, as a card: its title, then each cell under its column's name. */
function Row({
  locale,
  row,
  columns,
  strong,
  values,
}: {
  locale: string;
  row: NoticeRow;
  columns: Extract<NoticeBlock, { kind: 'rows' }>['columns'];
  strong: boolean;
  values: Values;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-card border border-default bg-surface p-3">
      {typeof row.title === 'string' ? (
        <p className={strong ? 'font-semibold' : undefined}>
          <NoticeText locale={locale} text={row.title} values={values} />
        </p>
      ) : (
        <p className="flex flex-wrap gap-x-3 font-semibold">
          {row.title.code.map((name) => (
            <code key={name} dir="ltr" className="font-mono text-[0.9em]">
              {name}
            </code>
          ))}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
        {row.cells.map((cell, at) => {
          const column = columns[at];
          return (
            <div key={cell + at} className="contents">
              <dt className="text-muted">
                {column !== undefined && <Translated locale={locale} message={column} />}
              </dt>
              <dd className="pb-1 sm:pb-0">
                <NoticeText locale={locale} text={cell} values={values} />
              </dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

function Block({
  locale,
  block,
  values,
  controller,
}: {
  locale: string;
  block: NoticeBlock;
  values: Values;
  controller: { postalAddress: string | null; icoNumber: string | null };
}) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <NoticeText locale={locale} text={block.text} values={values} />
        </p>
      );
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-2 ps-6">
          {block.items.map((item) => (
            <li key={item}>
              <NoticeText locale={locale} text={item} values={values} />
            </li>
          ))}
        </ul>
      );
    case 'contact':
      // The postal address and the ICO number only when the server has them
      // (D-465): the draft removes either line until it is decided.
      return (
        <ul className="flex list-disc flex-col gap-2 ps-6" data-testid="privacy-contact">
          <li>
            <NoticeText locale={locale} text="privacy.who.contact" values={values} />
          </li>
          {controller.postalAddress !== null && (
            <li data-testid="privacy-postal">
              <NoticeText locale={locale} text="privacy.who.postal" values={values} />
            </li>
          )}
          {controller.icoNumber !== null && (
            <li data-testid="privacy-ico">
              <NoticeText locale={locale} text="privacy.who.ico" values={values} />
            </li>
          )}
          <li>
            <NoticeText locale={locale} text="privacy.who.dpo" values={values} />
          </li>
        </ul>
      );
    case 'rows':
      return (
        <ul className="flex flex-col gap-3" data-testid={`privacy-rows-${block.id}`}>
          {block.rows.map((row, at) => (
            <Row
              key={at}
              locale={locale}
              row={row}
              columns={block.columns}
              strong={block.strongTitles}
              values={values}
            />
          ))}
        </ul>
      );
  }
}

function Blocks({
  locale,
  part,
  values,
  controller,
}: {
  locale: string;
  part: NoticePart;
  values: Values;
  controller: { postalAddress: string | null; icoNumber: string | null };
}) {
  return part.blocks.map((block, at) => (
    <Block key={at} locale={locale} block={block} values={values} controller={controller} />
  ));
}

/**
 * The privacy notice (T-1969, D-465), in English and Persian; every other
 * language is the English, marked. Its words are the catalogue's; who it
 * names comes from the server (`privacyController`): without a controller
 * and a mailbox the page says the notice is being prepared and shows
 * nothing that could pass for one (rule 3). Until the approved text is in
 * (`PRIVACY_NOTICE.effective`), it says it is a draft and not in effect.
 */
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE;
  // Request time, never the build's (`lib/privacy-notice.ts`).
  await connection();
  const controller = privacyController();

  const title = (
    <h1 className="border-s-4 border-s-accent ps-4 text-2xl font-semibold" data-testid="title">
      <Translated locale={locale} message="privacy.title" />
    </h1>
  );

  if (controller === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        {title}
        <Notice tone="info" data-testid="privacy-preparing">
          <Translated locale={locale} message="privacy.preparing" />
        </Notice>
      </main>
    );
  }

  const latin = directionOf(DEFAULT_LOCALE);
  const version = <bdi dir={latin}>{PRIVACY_NOTICE.version}</bdi>;
  const values: Values = {
    controller: <bdi className="font-semibold">{controller.name}</bdi>,
    email: (
      <a href={`mailto:${controller.email}`} dir={latin} className="underline">
        {controller.email}
      </a>
    ),
    address: <bdi>{controller.postalAddress}</bdi>,
    ico: <bdi dir={latin}>{controller.icoNumber}</bdi>,
    site: <bdi dir={latin}>{siteUrl()}</bdi>,
    icoLink: (
      <a href={ICO_COMPLAINTS} dir={latin} className="underline">
        {ICO_COMPLAINTS.replace(/^https:\/\//, '').replace(/\/$/, '')}
      </a>
    ),
    icoPhone: <bdi dir={latin}>{ICO_PHONE}</bdi>,
    pending: (
      <span data-pending="" className="rounded-sm border border-warning px-1 text-warning">
        <Translated locale={locale} message="privacy.pending" />
      </span>
    ),
    version,
    date:
      PRIVACY_NOTICE.effective === null
        ? null
        : formatDate(locale, PRIVACY_NOTICE.effective, 'UTC', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
  };
  const number = (...at: number[]) => localDigits(lang, at.map((n) => n + 1).join('.'));
  const onThisPage = attribute(lang, 'matchCentre.onThisPage');

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8 break-words" data-testid="privacy">
      {title}

      {PRIVACY_NOTICE.effective === null ? (
        <Notice tone="warning" role="note" data-testid="privacy-draft">
          <NoticeText locale={locale} text="privacy.draft" values={values} />
        </Notice>
      ) : (
        <p className="text-sm text-muted" data-testid="privacy-in-effect">
          <NoticeText locale={locale} text="privacy.inEffect" values={values} />
        </p>
      )}

      <p>
        <NoticeText locale={locale} text="privacy.intro" values={values} />
      </p>

      {/* A closed native list: one 48px line until it is opened (no script), as on /rules. */}
      <nav aria-label={onThisPage.text} lang={onThisPage.lang}>
        <details
          className="rounded-card border border-default bg-surface px-4"
          data-testid="privacy-index"
        >
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">
            <Translated locale={locale} message="matchCentre.onThisPage" />
          </summary>
          <ol className="flex flex-col pb-2">
            {NOTICE_SECTIONS.map((section, at) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex min-h-touch items-center gap-3 text-sm text-muted hover:text-fg hover:underline"
                >
                  <span className="w-5 shrink-0 text-end font-mono text-xs text-caption">
                    {number(at)}
                  </span>
                  <Translated locale={locale} message={section.heading} />
                </a>
              </li>
            ))}
          </ol>
        </details>
      </nav>

      <article className="flex flex-col gap-8" data-testid="privacy-body">
        {NOTICE_SECTIONS.map((section, at) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="flex flex-col gap-3"
            data-testid={`privacy-section-${section.id}`}
          >
            <h2 id={`${section.id}-heading`} className="flex gap-3 text-lg font-semibold">
              <span className="font-mono text-caption">{number(at)}</span>
              <Translated locale={locale} message={section.heading} />
            </h2>
            <Blocks locale={locale} part={section} values={values} controller={controller} />
            {section.parts?.map((part, sub) => (
              <section
                key={part.id}
                id={part.id}
                aria-labelledby={`${part.id}-heading`}
                className="flex flex-col gap-3 pt-2"
              >
                <h3 id={`${part.id}-heading`} className="flex gap-2 font-semibold">
                  <span className="font-mono text-caption">{number(at, sub)}</span>
                  <Translated locale={locale} message={part.heading} />
                </h3>
                <Blocks locale={locale} part={part} values={values} controller={controller} />
              </section>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
