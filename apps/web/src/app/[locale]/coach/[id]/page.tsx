import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchCoach, fetchMe } from '@/lib/api';
import { CoachBand, CoachCareerPanel, CoachLineupsPanel } from '@/components/coach-page';
import { Stamp } from '@/components/stamp';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';
import { say } from '@/lib/competition';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { pageTimeZone } from '@/lib/reader-time-zone-server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const fallback = `${say(locale, 'coachPage.title')} · Stadiomind`;
  if (!UUID.test(id)) return { title: fallback, robots: { index: false, follow: false } };
  const result = await fetchCoach(id, locale);
  if (!result.ok) return pageMetadata({ locale, path: `/coach/${id}`, title: fallback });
  const name = result.data.coach.name;
  return pageMetadata({
    locale,
    path: `/coach/${result.data.coach.id}`,
    title: `${name} · Stadiomind`,
    description: say(locale, 'coachPage.metaDescription', { name }),
  });
}

/**
 * The coach page (T-1439, D-230), reached from the team page's head coach and
 * manager: the band, the career as the data provider lists it at the teams we
 * cover, and the line-ups that name him. 404 for a person who is not a coach.
 */
export default async function CoachPageRoute({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!UUID.test(id)) notFound();
  const cookie = await sessionCookieHeader();
  const [result, me] = await Promise.all([fetchCoach(id, locale), fetchMe(cookie)]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return (
      <main data-mode="data" className="pb-16">
        <div className="page-frame flex flex-col gap-4 pt-8">
          <h1 className="text-2xl font-semibold">
            <Translated locale={locale} message="coachPage.title" />
          </h1>
          <Notice tone="danger" data-testid="coach-unreachable">
            <Translated locale={locale} message="coachPage.unreachable" />
          </Notice>
        </div>
      </main>
    );
  }
  const page = result.data;
  const { timeZone } = await pageTimeZone(locale, me);
  return (
    <main data-mode="data" className="pb-16" data-testid="coach-page">
      <CoachBand page={page} locale={locale} />
      <div className="page-frame flex flex-col gap-5 pt-6">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <CoachCareerPanel page={page} locale={locale} timeZone={timeZone} />
          <CoachLineupsPanel page={page} locale={locale} timeZone={timeZone} />
        </div>
        <p className="text-xs text-muted" data-testid="coach-updated">
          {page.last_updated_at === null ? (
            <Translated locale={locale} message="coachPage.noData" />
          ) : (
            <>
              <Translated locale={locale} message="competitionPage.lastUpdate" />{' '}
              <Stamp iso={page.last_updated_at} locale={locale} timeZone={timeZone} />
            </>
          )}
        </p>
      </div>
    </main>
  );
}
