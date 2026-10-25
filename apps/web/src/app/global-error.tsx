'use client';

import dynamic from 'next/dynamic';
import { useParams, usePathname } from 'next/navigation';
import { errorPageLocale, useErrorPageMessages } from '@/components/error-page';
import { directionOf } from '@/i18n/locales';

// The body and its stylesheet, fetched when this boundary is drawn (T-1536).
const GlobalErrorBody = dynamic(() => import('./global-error-body').then((m) => m.GlobalErrorBody));

/**
 * The last boundary (T-809): an error in the locale layout itself. It
 * replaces that layout, so it writes its own document -- and with it the
 * `lang` and `dir` the layout would have written, from the route's locale or
 * the path, never a document without them. Its own styles too, since the
 * layout's imports are gone with it (`global-error-body.tsx`). No theme
 * cookie here: the tokens follow the device, which is the honest default when
 * the layout that reads the cookie is the thing that failed.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const locale = errorPageLocale(params?.locale, pathname);
  const messages = useErrorPageMessages(locale);
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body>
        <title>Stadiomind</title>
        <GlobalErrorBody locale={locale} kind="failed" messages={messages} onRetry={retry} />
      </body>
    </html>
  );
}
