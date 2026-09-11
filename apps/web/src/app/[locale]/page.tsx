import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/components/json-ld';
import { fetchApiHealth } from '@/lib/api';
import { pageMetadata, websiteJsonLd } from '@/lib/seo';

// The API is queried per request, so a build never depends on it being up.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    path: '',
    title: 'FMIP',
    description:
      'Football match intelligence: live scores, match centre, forecasts and predictions.',
  });
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const health = await fetchApiHealth();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <JsonLd data={websiteJsonLd(locale)} />
      {/*
        The accent bar is deliberately asymmetric and deliberately logical:
        `border-s` and `ps` sit on the inline start, so they move to the right
        edge under `dir="rtl"`. The Playwright check in tests/e2e asserts exactly
        that, which makes this element the canary for a physical-property
        regression that slipped past lint.
      */}
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        FMIP
      </h1>
      <p>
        Football Match Intelligence Platform. Start with the{' '}
        <Link href={`/${locale}/scores`} className="underline">
          scores
        </Link>
        .
      </p>
      <p className="text-sm opacity-70">
        Locale: <code>{locale}</code>
      </p>
      <p className="text-sm opacity-70">
        {health.reachable ? (
          <>
            API: <code>{health.report.status}</code>, up for{' '}
            {Math.round(health.report.uptime_seconds)}s as of{' '}
            <time dateTime={health.report.checked_at}>{health.report.checked_at}</time>
          </>
        ) : (
          // Never render a healthy-looking placeholder for something we could
          // not reach (rule 3).
          <>API: unreachable</>
        )}
      </p>
    </main>
  );
}
