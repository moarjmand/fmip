import type { ReactNode } from 'react';
import { Translated } from '@/components/translated';
import { asLocale } from '@/lib/prediction-text';

/**
 * The statistical model's box beside a pick (T-1738, D-359; the board's
 * `ModelBox`): the MODEL tag, the line that says it stands beside the pick
 * and is never mixed with it, and the caller's forecast -- `ForecastBar`,
 * with its percentages in words and its version-and-time receipt, or the
 * coverage state when there is no forecast (rules 3 and 6).
 *
 * Turquoise is the model's colour and appears here only; the pick control
 * (`pick-control.tsx`) takes this box as a slot and never draws a figure of
 * the model's itself. The tag is an outline, not a tint: on its own tint the
 * Day turquoise measured 4.2:1 (T-1545), and there is no `model-tint` token.
 */
export function ModelBox({
  locale,
  testId = 'model-box',
  children,
}: {
  locale: string;
  testId?: string;
  children: ReactNode;
}) {
  const l = asLocale(locale);
  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl border border-default p-3"
      data-testid={testId}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="rounded-sm border border-model px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tracking-wide text-model uppercase [:root:is(:lang(fa),:lang(ar))_&]:font-sans">
          <Translated locale={l} message="scores.preview.model" />
        </span>
        <span className="text-sm text-muted">
          <Translated locale={l} message="scores.preview.modelNote" />
        </span>
      </p>
      {children}
    </div>
  );
}
