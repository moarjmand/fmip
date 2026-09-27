import { useId } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * A card (T-603): a panel a step off the page (`bg-surface`), a hairline
 * edge, and room inside. With a heading it is a named region (a `section`
 * labelled by it), so a screen reader's landmark list can reach it; without
 * one it is a plain box.
 */

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  heading?: ReactNode;
  /** The heading's rank in the page's outline; the card does not guess it. */
  headingLevel?: 2 | 3 | 4;
  as?: 'section' | 'div' | 'article' | 'li';
  /** `sm` for a card in a dense list (an admin queue), `md` otherwise. */
  padding?: 'sm' | 'md';
  className?: string;
  children: ReactNode;
}

export function Card({
  heading,
  headingLevel = 2,
  as,
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  const generated = useId();
  const hasHeading = heading !== undefined && heading !== null;
  const Tag = as ?? (hasHeading ? 'section' : 'div');
  const headingId = hasHeading ? `card${generated.replace(/:/g, '')}` : undefined;
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  return (
    <Tag
      aria-labelledby={Tag === 'section' ? headingId : undefined}
      className={cx(
        'flex flex-col rounded border border-default bg-surface',
        padding === 'sm' ? 'gap-2 p-3' : 'gap-3 p-4',
        className,
      )}
      {...rest}
    >
      {hasHeading && (
        <Heading
          id={headingId}
          className={headingLevel === 2 ? 'text-lg font-semibold' : 'font-semibold'}
        >
          {heading}
        </Heading>
      )}
      {children}
    </Tag>
  );
}
