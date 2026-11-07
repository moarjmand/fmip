import type { FormResult } from '@fmip/contracts';
import { FORM_KEY, formLine, say } from '@/lib/competition';

/**
 * A form square's look (T-1746, D-367): filled, outlined or dashed in ink,
 * never a hue. One look for the form wherever it is drawn: the match
 * centre's competition context and the competition page's tables (T-1760,
 * D-377).
 */
export const FORM_SQUARE: Record<FormResult, string> = {
  W: 'bg-fg text-surface',
  D: 'border border-strong text-fg',
  L: 'border border-dashed border-caption text-muted',
};

/**
 * A table's form as D-367's squares (T-1760, D-377; board P5-2): each result
 * a 17px square carrying its letter, most recent first as the contract lists
 * them, the run read out once in words. Each square is its own box, so
 * Persian letters never join into a word (T-1557).
 */
export function FormSquares({ locale, form }: { locale: string; form: FormResult[] }) {
  return (
    <span className="inline-flex" data-testid="form">
      <span aria-hidden="true" className="inline-flex gap-[3px]">
        {form.map((result, i) => (
          <span
            key={i}
            data-result={result}
            className={`inline-grid size-[17px] place-items-center rounded-xs text-[10px] leading-none font-extrabold ${FORM_SQUARE[result]}`}
          >
            {say(locale, FORM_KEY[result])}
          </span>
        ))}
      </span>
      <span className="sr-only">{formLine(locale, form)}</span>
    </span>
  );
}
