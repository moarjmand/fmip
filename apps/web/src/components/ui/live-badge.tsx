import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * A match in play, with its minute (the Design System's `LiveBadge`, T-1493,
 * D-263): a saffron pill with a dot, the words in saffron as text. Above the
 * score in a match hero; in a list the row's own live status does the job.
 *
 * The words are the caller's, already resolved: `children` is the status the
 * page already writes ("67′", "HT"), `label` the word "Live" in the reader's
 * language when the status does not already say it. The dot pulses only where
 * motion is welcome (`.live-dot` in globals.css honours the device's and the
 * member's reduced motion) and is hidden from screen readers: the words say
 * it. Server-component safe.
 */
export function LiveBadge({
  label,
  children,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-live-badge=""
      className={cx(
        'inline-flex min-h-7.5 items-center gap-2 rounded-pill bg-brand/14 px-3 text-sm font-extrabold text-live tabular-nums',
        className,
      )}
    >
      <span aria-hidden="true" className="live-dot size-2 shrink-0 rounded-full bg-brand" />
      {label !== undefined && <span>{label} · </span>}
      {children}
    </span>
  );
}
