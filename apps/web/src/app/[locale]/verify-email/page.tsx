import type { Metadata } from 'next';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';

export const metadata: Metadata = { title: 'Verify e-mail · FMIP' };
export const dynamic = 'force-dynamic';

/**
 * The link from the verification e-mail lands here. The token is spent on
 * this render: it is single-use in the database, so a second visit, a
 * refresh, or a link-previewing mail client gets the "already used" answer
 * rather than a second success.
 */
export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const { token } = await searchParams;

  const result =
    token === undefined || token === ''
      ? null
      : await apiRequest<{ verified: true }>('/auth/verify-email', {
          method: 'POST',
          body: { token },
        });

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">E-mail verification</h1>
      {result === null ? (
        <p role="alert">This page needs the link from your e-mail.</p>
      ) : result.ok ? (
        <p role="status" data-testid="verify-result">
          Your e-mail address is verified. You can now submit predictions.
        </p>
      ) : result.status === 0 ? (
        <p role="alert">The service is unreachable right now. Open the link again in a moment.</p>
      ) : (
        <p role="alert" data-testid="verify-result">
          {result.error?.message ?? 'This link is invalid, has expired, or was already used.'}
        </p>
      )}
      <p className="text-sm">
        <Link href={`/${locale}`}>Back to FMIP</Link>
      </p>
    </main>
  );
}
