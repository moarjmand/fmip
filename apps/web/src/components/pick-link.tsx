import type { ReactNode } from 'react';
import Link from '@/components/ui/link';
import { cx } from '@/components/ui/cx';

/**
 * The way to a pick from a card that is not the pick control (T-1741,
 * D-362): one link to the match page's pick card (`pickCardPath`), drawn as
 * a secondary button in the saffron edge and ink (`accent`), 44px tall. An
 * outline, never the saffron fill: that stays the view's one primary.
 *
 * It is the `md` button's box with another edge, and it lives here rather
 * than as a variant in `ui/button.tsx` on purpose: that module is in every
 * page's client bundle, and a variant there cost each budgeted route about
 * 30 bytes gzip of first-load JavaScript for a link only server components
 * draw (the next-match card, the story's predictions card). If the button's
 * `md` box changes, change this with it; `pick-link.spec.tsx` holds the two
 * together.
 */
export function PickLink({
  href,
  testId,
  className,
  children,
}: {
  href: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-accent px-4 py-2 text-sm font-bold text-accent',
        className,
      )}
    >
      {children}
    </Link>
  );
}
