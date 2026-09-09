import { fetchApiHealth } from '@/lib/api';

// The API is queried per request, so a build never depends on it being up.
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const health = await fetchApiHealth();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">FMIP</h1>
      <p>
        Football Match Intelligence Platform. Nothing is built here yet — the scores page arrives in
        T-031.
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
