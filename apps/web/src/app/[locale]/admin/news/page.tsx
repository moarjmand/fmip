import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { STORY_TYPES, type StoryType } from '@fmip/contracts';
import { NewsDesk, type DeskSelection } from '@/components/news-desk';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/messages';
import {
  fetchBreakingMarks,
  fetchDebateRecords,
  fetchMe,
  fetchNewsSection,
  fetchRecentAudit,
  fetchStory,
} from '@/lib/api';
import { STORY_TYPE_KEY } from '@/lib/news';
import { storyHistory, storyIdFrom } from '@/lib/news-desk';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '/admin/news',
    title: 'News desk',
    description: 'Story types, breaking marks and the debate page, with each decision recorded.',
    index: false,
  });
}

/**
 * The editor's news desk (T-1009). The role is the API's to check (editors
 * and administrators): the editor's debate list answers or refuses, and a
 * refusal is said rather than shown as an empty desk (T-904).
 */
export default async function NewsDeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ story?: string }>;
}) {
  const { locale } = await params;
  const { story: given } = await searchParams;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login?next=/${locale}/admin/news`);

  const debates = await fetchDebateRecords(cookie);
  const header = (
    <>
      <p className="text-sm">
        <Link href={`/${locale}/admin`} className="underline">
          ← Admin
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">News desk</h1>
    </>
  );
  if (!debates.ok) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
        {header}
        {debates.status === 403 ? (
          <Notice tone="warning" data-testid="news-desk-forbidden">
            The news desk needs the editor or administrator role.
          </Notice>
        ) : (
          <Notice tone="danger" data-testid="news-desk-unreachable">
            The news desk cannot be shown right now.
          </Notice>
        )}
      </main>
    );
  }

  const storyId = storyIdFrom(given);
  const [marks, latest, audit, story] = await Promise.all([
    fetchBreakingMarks(cookie),
    fetchNewsSection('?section=latest', locale, cookie),
    // Administrators only; an editor's 403 means the type's earlier labels are not shown.
    storyId === null ? null : fetchRecentAudit(cookie),
    storyId === null ? null : fetchStory(storyId, null, locale),
  ]);
  const records = debates.data.selections;
  const markList = marks.ok ? marks.data.marks : [];
  const language = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const typeNames = Object.fromEntries(
    STORY_TYPES.map((type) => [type, t(language, STORY_TYPE_KEY[type])]),
  ) as Record<StoryType, string>;

  let selection: DeskSelection | null = null;
  if (storyId !== null && story?.ok === true) {
    const card = story.data.story;
    selection = {
      card,
      debate: records.find((d) => d.story_id === card.story_id && d.cleared_at === null) ?? null,
      history: storyHistory(
        card.story_id,
        records,
        markList,
        audit?.ok === true ? audit.data.records : null,
      ),
      typeHistory: audit?.ok === true ? 'shown' : 'administrators_only',
    };
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      {header}
      {!marks.ok && (
        <Notice tone="danger" data-testid="news-desk-marks-unreachable">
          The breaking marks cannot be read right now, so a story&apos;s record may be missing them.
        </Notice>
      )}
      <NewsDesk
        locale={locale}
        typeNames={typeNames}
        stories={latest.ok && latest.data.stories.data !== null ? latest.data.stories.data : null}
        openDebates={records.filter((d) => d.cleared_at === null)}
        liveMarks={markList.filter((m) => m.state === 'live')}
        selection={selection}
        asked={storyId !== null && selection === null ? (given ?? null) : null}
      />
    </main>
  );
}
