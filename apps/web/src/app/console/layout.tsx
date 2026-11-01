import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// The site's own font and stylesheet (T-601, D-089): the console looks like
// Stadiomind, without the site's header, rail or footer.
import '@fontsource-variable/vazirmatn';
import '../globals.css';

/**
 * The agents console's root (D-340): its own `<html>`, apart from the site's
 * `[locale]` layout. Persian, right to left, for the maintainer and the
 * teammate; never indexed, never framed.
 */
export const metadata: Metadata = {
  title: { default: 'کنسول عامل‌ها · Stadiomind', template: '%s · کنسول عامل‌ها' },
  robots: { index: false, follow: false, nocache: true },
  referrer: 'same-origin',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function ConsoleRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-dvh bg-canvas text-fg">{children}</body>
    </html>
  );
}
