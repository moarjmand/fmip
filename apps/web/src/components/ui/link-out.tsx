import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { inlineTargetClasses } from './target';

/**
 * A link that leaves FMIP (T-1388, D-206): a broadcaster's page, a
 * publisher's highlights. It always names who hosts the destination --
 * `host` is required, so a link-out with no name cannot be written -- and it
 * carries the external-link mark, so nobody follows it thinking they are
 * staying on the site. Nothing is hosted here (D-014): the reader goes to
 * the official page.
 *
 *   button  a full control on the ink (44px), for the one link a section is
 *           for: "Official highlights (publisher) ↗"
 *   inline  inside a line of text, at the 24px inline floor (`target.ts`):
 *           "Watch: IRIB TV3 ↗ · Telewebion ↗"
 *
 * The visible words are `label (host)`, or the host alone when the label
 * would only repeat it (a broadcaster's own name). Same window, as every
 * external link on the site opens (`viewing-panel.tsx`); `noopener
 * noreferrer` so the destination learns nothing about the page that sent the
 * reader. No directive and no catalogue import.
 */
export function LinkOut({
  href,
  host,
  children,
  look = 'inline',
  icon,
  className,
  testId,
}: {
  href: string;
  /** Who hosts the destination, in the reader's script where it has one: "IRIB TV3", "the publisher". */
  host: string;
  /** What the link opens, when that is more than the host's name. */
  children?: ReactNode;
  look?: 'button' | 'inline';
  /** A leading icon for the button look (a play mark for highlights). */
  icon?: IconName;
  className?: string;
  testId?: string;
}) {
  const words =
    children === undefined ? (
      <bdi>{host}</bdi>
    ) : (
      <span>
        {children} (<bdi>{host}</bdi>)
      </span>
    );
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      data-testid={testId}
      data-link-out={host}
      className={cx(
        look === 'button'
          ? 'inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-fg bg-fg px-4 font-semibold text-canvas'
          : inlineTargetClasses('gap-1 font-medium underline'),
        className,
      )}
    >
      {look === 'button' && icon !== undefined && <Icon name={icon} size={18} />}
      {words}
      <Icon name="external" size={look === 'button' ? 16 : 14} />
    </a>
  );
}
