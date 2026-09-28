'use client';

import { useParams } from 'next/navigation';
import { ErrorPageBody, errorPageLocale } from '@/components/error-page';

/**
 * A page that failed to render, inside the locale (T-809). The boundary sits
 * below the locale layout, so the header, the skip link and `<html lang dir>`
 * stay; only the content is replaced. The error itself is not shown: in
 * production it is a digest, and the server log already has it.
 */
export default function LocaleError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  return <ErrorPageBody locale={errorPageLocale(params?.locale)} kind="failed" onRetry={retry} />;
}
