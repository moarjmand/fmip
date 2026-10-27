import { Fragment, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';

/**
 * The model's provenance line (the Design System's `Receipt`, T-1508, D-263):
 * model version, forecast version, when it was computed -- the items joined
 * with " · ", in the machine-fact mono face and the model's colour, on a
 * dashed rule directly under the forecast it describes. Every model forecast
 * on every page has one (blueprint 6.2: the version and the time are always
 * on screen); forecasts are never edited (rule 5), so each version keeps its
 * own.
 *
 * The model's colour on the page's own grounds only: on Day the turquoise
 * passes 4.5:1 on the bare ground with little to spare (4.65:1), so a receipt
 * is never set on a tint. Persian is set in the interface face, which has
 * the Persian digits the mono face lacks. Server-component safe.
 */
export function Receipt({
  items,
  className,
  testId = 'receipt',
}: {
  /** Each a fact, already in the reader's language; empty ones are left out. */
  items: ReactNode[];
  className?: string;
  testId?: string;
}) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false);
  return (
    <p
      className={cx(
        'flex flex-wrap items-center gap-x-1.5 border-t border-dashed border-default pt-2 font-mono text-xs leading-relaxed text-model [:root:is(:lang(fa),:lang(ar))_&]:font-sans',
        className,
      )}
      data-testid={testId}
    >
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}
