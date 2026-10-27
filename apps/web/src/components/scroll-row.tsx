'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * A row that scrolls sideways without a scrollbar (T-1624, D-292): the
 * matchday rail and its drawer. The native bar is hidden (`scroll-row` in
 * globals.css); instead the edge with more beyond it fades, and from 768px a
 * small chevron there scrolls the row by most of its width. Both edges are
 * the inline ones, so on `/fa` the start is on the right.
 *
 * The chevrons are a pointer's shortcut and nothing more: the keyboard
 * reaches every item with Tab, which scrolls it into view (the row's
 * `scroll-padding-inline` keeps it clear of the fade), and a screen reader
 * reads the list whole, so they are out of the tab order and hidden from it.
 * Without a script there are no fades or chevrons and the row still scrolls.
 * Its looks are in globals.css, so this island carries no class strings of
 * its own beyond the ones it is handed (D-264).
 */
export function ScrollRow({
  className,
  listClassName,
  testId,
  children,
}: {
  /** The row's box, in its parent's layout. */
  className?: string;
  /** The `<ul>`'s own classes: its gap and padding. */
  listClassName?: string;
  testId?: string;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  useEffect(() => {
    const row = list.current;
    if (row === null) return;
    const measure = () => {
      // Right to left, `scrollLeft` runs from 0 to minus the overflow.
      const reach = row.scrollWidth - row.clientWidth;
      const at = Math.abs(row.scrollLeft);
      const next = { start: at > 1, end: reach - at > 1 };
      setMore((was) => (was.start === next.start && was.end === next.end ? was : next));
    };
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const resized = new ResizeObserver(measure);
    resized.observe(row);
    return () => {
      row.removeEventListener('scroll', measure);
      resized.disconnect();
    };
  }, []);

  const page = (towards: 'start' | 'end') => {
    const row = list.current;
    if (row === null) return;
    const rtl = getComputedStyle(row).direction === 'rtl';
    const still =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.dataset.motion === 'reduce';
    const step = row.clientWidth * 0.8 * (towards === 'end' ? 1 : -1) * (rtl ? -1 : 1);
    row.scrollBy({ left: step, behavior: still ? 'auto' : 'smooth' });
  };

  const chevron = (edge: 'start' | 'end') => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className="scroll-chevron"
      data-edge={edge}
      onClick={() => page(edge)}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d={edge === 'start' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
      </svg>
    </button>
  );

  return (
    <div
      className={`scroll-row ${className ?? ''}`}
      data-more-start={more.start ? '' : undefined}
      data-more-end={more.end ? '' : undefined}
    >
      {chevron('start')}
      <ul ref={list} className={listClassName} data-testid={testId}>
        {children}
      </ul>
      {chevron('end')}
    </div>
  );
}
