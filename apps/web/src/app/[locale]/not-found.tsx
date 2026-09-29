'use client';

import { useParams } from 'next/navigation';
import { ErrorPageBody, errorPageLocale, useErrorPageMessages } from '@/components/error-page';

/**
 * A page that does not exist, inside the locale (T-809): a page's own
 * `notFound()` (a malformed id, an unknown competition) and any unknown path
 * under a locale (`[...missing]/page.tsx`) land here, so the document is the
 * locale layout's and carries its `lang` and `dir`. A client component only
 * because a not-found file receives no props: the locale comes from the
 * router.
 */
export default function LocaleNotFound() {
  const params = useParams<{ locale?: string }>();
  const locale = errorPageLocale(params?.locale);
  const messages = useErrorPageMessages(locale);
  return <ErrorPageBody locale={locale} kind="not-found" messages={messages} />;
}
