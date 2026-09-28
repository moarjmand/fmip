import type { Metadata } from 'next';
import Link from 'next/link';
import { Translated } from '@/components/translated';

export const metadata: Metadata = {
  title: 'Account deleted · FMIP',
  robots: { index: false, follow: false },
};

/**
 * Where "Delete my account" lands (T-812, D-094): the one sentence that says
 * it happened. There is no session any more, so the page needs nothing from
 * the API and reads the same for anybody who opens it.
 */
export default async function AccountDeletedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">
        <Translated locale={locale} message="account.deleted.title" />
      </h1>
      <p role="status" data-testid="account-deleted">
        <Translated locale={locale} message="account.deleted.body" />
      </p>
      <p>
        <Link href={`/${locale}/scores`} className="underline">
          <Translated locale={locale} message="nav.scores" />
        </Link>
      </p>
    </main>
  );
}
