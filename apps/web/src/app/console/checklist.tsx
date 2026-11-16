import type {
  ConsoleChecklistItem,
  ConsoleChecklistPerson,
  ConsoleChecklistSection,
} from '@fmip/contracts';
import { CONSOLE_CHECKLIST_TITLE_MAX } from '@fmip/contracts/console';
import { addChecklistItem } from '@/lib/console-actions';
import { ChecklistItemRow, type SectionChoice } from './checklist-item';
import { STATUS_TONE, type Progress, progressOf } from './checklist-words';
import { ConsoleForm } from './console-form';
import { fa, inputClass } from './ui';

/**
 * The pre-launch checklist's server-drawn pieces (T-1840, D-428): the
 * progress bar of a list or a section (done, in progress, blocked, not
 * started, over the items that count; «لازم نیست» leaves the count), a
 * section's card with its items and its add form.
 */

/**
 * The bar's segments, from the inline start: what is done first. Not started
 * is the empty track, so a list nobody has begun reads as empty, not full.
 */
const BAR_ORDER = ['done', 'in_progress', 'blocked'] as const;

export function ProgressBar({ progress, size = 'md' }: { progress: Progress; size?: 'sm' | 'md' }) {
  const label =
    progress.counted === 0
      ? 'موردی برای شمردن نیست'
      : `${fa(progress.done)} از ${fa(progress.counted)} انجام شد (${fa(progress.percent)}٪)`;
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex w-full overflow-hidden rounded-pill bg-surface-raised ${size === 'sm' ? 'h-1.5' : 'h-2.5'}`}
    >
      {progress.counted > 0 &&
        BAR_ORDER.map((status) =>
          progress.by[status] === 0 ? null : (
            <span
              key={status}
              className={`h-full ${STATUS_TONE[status].bar}`}
              style={{ width: `${(progress.by[status] * 100) / progress.counted}%` }}
            />
          ),
        )}
    </div>
  );
}

/**
 * "۱۲ از ۵۷ انجام شد · ۲۱٪" and, when there are any, the items left out of
 * the count. Nothing done is said in words: a bold Persian zero reads as a dot.
 */
export function ProgressWords({ progress }: { progress: Progress }) {
  const notNeeded =
    progress.by.not_needed > 0 ? <> · {fa(progress.by.not_needed)} لازم نیست</> : null;
  if (progress.done === 0)
    return (
      <span className="text-sm text-muted">
        {progress.counted === 0
          ? 'موردی برای شمردن نیست'
          : `هنوز هیچ‌کدام از ${fa(progress.counted)} مورد انجام نشده`}
        {notNeeded}
      </span>
    );
  return (
    <span className="text-sm text-muted">
      <span className="font-bold text-fg">{fa(progress.done)}</span> از {fa(progress.counted)} انجام
      شد · {fa(progress.percent)}٪{notNeeded}
    </span>
  );
}

/** One section: its heading and progress, its items (filtered or not), and the add form. */
export function SectionCard({
  section,
  shown,
  people,
  sections,
  sectionTitle,
  filtered,
}: {
  section: ConsoleChecklistSection;
  shown: readonly ConsoleChecklistItem[];
  people: readonly ConsoleChecklistPerson[];
  sections: readonly SectionChoice[];
  sectionTitle: Record<string, string>;
  filtered: boolean;
}) {
  const progress = progressOf(section.items);
  const headingId = `section-${section.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-default bg-surface p-3 md:p-5"
      data-testid="checklist-section"
    >
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={headingId} className="text-base font-bold text-fg">
            {section.title}
          </h2>
          <ProgressWords progress={progress} />
        </div>
        <ProgressBar progress={progress} size="sm" />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-caption">
          {filtered ? 'در این بخش موردی با این فیلتر نیست.' : 'این بخش هنوز موردی ندارد.'}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {shown.map((item) => {
            const at = section.items.findIndex((i) => i.id === item.id);
            return (
              <ChecklistItemRow
                key={item.id}
                item={item}
                people={people}
                sections={sections}
                sectionTitle={sectionTitle}
                first={at === 0}
                last={at === section.items.length - 1}
              />
            );
          })}
        </ol>
      )}
      {!filtered && (
        <details className="mt-3 group">
          <summary className="inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-control px-2 text-sm font-bold text-brand hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <span aria-hidden="true">+</span> افزودن مورد به این بخش
          </summary>
          <ConsoleForm
            action={addChecklistItem}
            submit="افزودن"
            className="mt-2 flex flex-col gap-2"
          >
            <input type="hidden" name="section_id" value={section.id} />
            <label htmlFor={`new-${section.id}`} className="sr-only">
              متن مورد تازه
            </label>
            <textarea
              id={`new-${section.id}`}
              name="title"
              required
              rows={2}
              maxLength={CONSOLE_CHECKLIST_TITLE_MAX}
              dir="auto"
              placeholder="متن مورد تازه…"
              className={`${inputClass} py-2 leading-7`}
            />
          </ConsoleForm>
        </details>
      )}
    </section>
  );
}
