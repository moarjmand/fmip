import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline · FMIP',
  robots: { index: false, follow: false },
};

/**
 * The offline shell (T-082, D-042): what the service worker shows when a
 * page cannot be fetched. It says so; it never shows a cached score as if
 * it were current (rule 4).
 */
export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="border-s-4 border-s-current ps-4 text-2xl font-semibold" data-testid="title">
        You are offline
      </h1>
      <p role="status" data-testid="offline-message">
        FMIP needs a connection for live scores, matches and predictions. Nothing cached is shown as
        current: when you are back online, the pages will load fresh.
      </p>
      <p>
        <Link href={`/${locale}/scores`} className="underline">
          Try the scores again
        </Link>
      </p>
    </main>
  );
}
