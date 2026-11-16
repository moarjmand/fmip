'use client';

import { useId, useOptimistic, useState, useTransition } from 'react';
import type {
  ConsoleChecklistAssignee,
  ConsoleChecklistItem,
  ConsoleChecklistPerson,
  ConsoleChecklistStatus,
} from '@fmip/contracts';
import {
  CONSOLE_CHECKLIST_NOTE_MAX,
  CONSOLE_CHECKLIST_REASON_MAX,
  CONSOLE_CHECKLIST_STATUSES,
  CONSOLE_CHECKLIST_TITLE_MAX,
} from '@fmip/contracts/console';
import {
  type ChecklistResult,
  addChecklistNote,
  moveChecklistItem,
  removeChecklistItem,
  updateChecklistItem,
} from '@/lib/console-actions';
import {
  AGENTS_WORDS,
  NOBODY_WORDS,
  STATUS_TONE,
  STATUS_WORDS,
  historyWords,
} from './checklist-words';
import { fa, inputClass, when } from './ui';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const SELECT = `min-h-touch w-full rounded-control border bg-canvas text-sm ${FOCUS}`;
const SECONDARY = `inline-flex min-h-touch items-center justify-center gap-1 rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised disabled:opacity-50 ${FOCUS}`;
const PRIMARY = `inline-flex min-h-touch items-center justify-center rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 ${FOCUS}`;
const DANGER = `inline-flex min-h-touch items-center justify-center rounded-control border border-danger bg-surface px-3 text-sm font-bold text-danger disabled:opacity-50 ${FOCUS}`;

/** A section the item can be moved to, with its list's short name. */
export interface SectionChoice {
  id: string;
  label: string;
}

/**
 * One checklist item (T-1840, D-428), the page's one client part: its status
 * and who must do it in front of it, changed in place (the page shows the
 * new value at once and the server's answer after); a toggle opens its
 * notes, its history and the controls that manage it (text, section, order,
 * removal with a reason).
 */
export function ChecklistItemRow({
  item,
  people,
  sections,
  sectionTitle,
  first,
  last,
}: {
  item: ConsoleChecklistItem;
  people: readonly ConsoleChecklistPerson[];
  sections: readonly SectionChoice[];
  sectionTitle: Record<string, string>;
  first: boolean;
  last: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [shown, show] = useOptimistic(
    { status: item.status, assignee: item.assignee },
    (
      current,
      next: Partial<{ status: ConsoleChecklistStatus; assignee: ConsoleChecklistAssignee }>,
    ) => ({
      ...current,
      ...next,
    }),
  );

  /** Runs an action; its error, in Persian, is said under the row. */
  const run = (work: () => Promise<ChecklistResult>, optimistic?: Parameters<typeof show>[0]) =>
    new Promise<boolean>((resolve) => {
      setError(null);
      start(async () => {
        if (optimistic !== undefined) show(optimistic);
        const result = await work();
        if (!result.ok) setError(result.error);
        resolve(result.ok);
      });
    });

  const tone = STATUS_TONE[shown.status];
  const assigneeValue = shown.assignee ?? '';
  const choices = people.filter((p) => p.enabled || p.id === shown.assignee);

  return (
    <li
      className={`rounded-tile border bg-canvas ${open ? 'border-strong' : 'border-default'}`}
      data-testid="checklist-item"
      data-status={shown.status}
    >
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2 p-3 md:grid-cols-[minmax(9rem,10rem)_minmax(0,1fr)_minmax(10rem,13rem)_auto] md:gap-3">
        <p
          className={`col-span-2 text-sm leading-7 md:col-span-1 md:col-start-2 md:row-start-1 ${
            shown.status === 'done' || shown.status === 'not_needed' ? 'text-muted' : 'text-fg'
          }`}
          dir="auto"
        >
          {item.title}
        </p>

        <div className="relative md:col-start-1 md:row-start-1">
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute start-3 top-1/2 size-2.5 -translate-y-1/2 rounded-pill ${tone.dot}`}
          />
          <select
            aria-label="وضعیت"
            value={shown.status}
            disabled={pending}
            onChange={(e) => {
              const status = e.target.value as ConsoleChecklistStatus;
              void run(() => updateChecklistItem(item.id, { status }), { status });
            }}
            className={`${SELECT} ps-7 pe-2 font-bold ${tone.control}`}
          >
            {CONSOLE_CHECKLIST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_WORDS[s]}
              </option>
            ))}
          </select>
        </div>

        <select
          aria-label="مسئول"
          value={assigneeValue}
          disabled={pending}
          onChange={(e) => {
            const assignee = e.target.value === '' ? null : e.target.value;
            void run(() => updateChecklistItem(item.id, { assignee }), { assignee });
          }}
          className={`${SELECT} border-strong px-2 md:col-start-3 md:row-start-1 ${
            shown.assignee === null ? 'text-caption' : 'text-fg'
          }`}
        >
          <option value="">{NOBODY_WORDS}</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.enabled}>
              {p.display_name}
              {p.owner ? ' (نگهدارنده)' : ''}
            </option>
          ))}
          <option value="agents">{AGENTS_WORDS}</option>
        </select>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-detail`}
          onClick={() => setOpen((o) => !o)}
          className={`${SECONDARY} col-span-2 md:col-span-1 md:col-start-4 md:row-start-1`}
        >
          <span>{item.notes.length > 0 ? `${fa(item.notes.length)} یادداشت` : 'یادداشت'}</span>
          <span aria-hidden="true" className="text-caption">
            {open ? '▴' : '▾'}
          </span>
        </button>
      </div>

      <p role="status" aria-live="polite" className="px-3 text-sm text-danger empty:hidden">
        {error}
      </p>

      {open && (
        <ItemDetail
          id={`${id}-detail`}
          item={item}
          people={people}
          sections={sections}
          sectionTitle={sectionTitle}
          first={first}
          last={last}
          pending={pending}
          run={run}
        />
      )}
      {!open && item.updated_by !== null && (
        <p className="px-3 pb-2 text-xs text-caption">
          آخرین تغییر: <span dir="auto">{item.updated_by}</span>، {when(item.updated_at)}
        </p>
      )}
    </li>
  );
}

type Run = (work: () => Promise<ChecklistResult>) => Promise<boolean>;

/** What the toggle opens: the notes, the history and the controls that manage the item. */
export function ItemDetail({
  id,
  item,
  people,
  sections,
  sectionTitle,
  first,
  last,
  pending,
  run,
}: {
  id: string;
  item: ConsoleChecklistItem;
  people: readonly ConsoleChecklistPerson[];
  sections: readonly SectionChoice[];
  sectionTitle: Record<string, string>;
  first: boolean;
  last: boolean;
  pending: boolean;
  run: Run;
}) {
  return (
    <div id={id} className="grid gap-4 border-t border-default p-3 md:grid-cols-2 md:gap-6">
      <Notes item={item} pending={pending} run={run} />
      <div className="flex flex-col gap-4">
        <History item={item} people={people} sectionTitle={sectionTitle} />
        <Manage
          item={item}
          sections={sections}
          first={first}
          last={last}
          pending={pending}
          run={run}
        />
      </div>
    </div>
  );
}

function Notes({ item, pending, run }: { item: ConsoleChecklistItem; pending: boolean; run: Run }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h3 id={`${id}-h`} className="text-sm font-bold text-fg">
        یادداشت‌ها
      </h3>
      {item.notes.length === 0 ? (
        <p className="text-sm text-caption">هنوز یادداشتی نیست.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {item.notes.map((note) => (
            <li key={note.id} className="rounded-tile bg-surface-raised p-3">
              <p className="mb-1 flex flex-wrap gap-x-2 text-xs text-muted">
                <span className="font-bold text-fg" dir="auto">
                  {note.author}
                </span>
                <span>{when(note.created_at)}</span>
              </p>
              <p className="whitespace-pre-line text-sm leading-7 text-fg" dir="auto">
                {note.body}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = draft;
          void run(() => addChecklistNote(item.id, body)).then((ok) => {
            if (ok) setDraft('');
          });
        }}
      >
        <label htmlFor={`${id}-note`} className="sr-only">
          یادداشت تازه
        </label>
        <textarea
          id={`${id}-note`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={CONSOLE_CHECKLIST_NOTE_MAX}
          rows={2}
          dir="auto"
          placeholder="یادداشت تازه…"
          className={`${inputClass} py-2 leading-7`}
        />
        <div>
          <button type="submit" disabled={pending || draft.trim() === ''} className={PRIMARY}>
            افزودن یادداشت
          </button>
        </div>
      </form>
    </section>
  );
}

function History({
  item,
  people,
  sectionTitle,
}: {
  item: ConsoleChecklistItem;
  people: readonly ConsoleChecklistPerson[];
  sectionTitle: Record<string, string>;
}) {
  const id = useId();
  const title = (sectionId: string) => sectionTitle[sectionId] ?? 'بخش دیگر';
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2">
      <h3 id={`${id}-h`} className="text-sm font-bold text-fg">
        تاریخچه‌ی تغییرها
      </h3>
      {item.history.length === 0 ? (
        <p className="text-sm text-caption">از فهرست اولیه؛ هنوز تغییری نکرده.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 border-s-2 border-default ps-3">
          {[...item.history].reverse().map((event, i) => (
            <li key={`${event.created_at}-${i}`} className="text-sm leading-6">
              <span className="font-bold" dir="auto">
                {event.actor}
              </span>{' '}
              <span className="text-muted">{historyWords(event, people, title)}</span>
              <span className="block text-xs text-caption">{when(event.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Manage({
  item,
  sections,
  first,
  last,
  pending,
  run,
}: {
  item: ConsoleChecklistItem;
  sections: readonly SectionChoice[];
  first: boolean;
  last: boolean;
  pending: boolean;
  run: Run;
}) {
  const id = useId();
  const [title, setTitle] = useState(item.title);
  const [section, setSection] = useState(item.section_id);
  const [reason, setReason] = useState('');
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3">
      <h3 id={`${id}-h`} className="text-sm font-bold text-fg">
        مدیریت مورد
      </h3>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => updateChecklistItem(item.id, { title }));
        }}
      >
        <label htmlFor={`${id}-title`} className="text-xs text-muted">
          متن مورد
        </label>
        <textarea
          id={`${id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={CONSOLE_CHECKLIST_TITLE_MAX}
          rows={2}
          dir="auto"
          className={`${inputClass} py-2 leading-7`}
        />
        <div>
          <button
            type="submit"
            disabled={pending || title.trim() === '' || title.trim() === item.title}
            className={SECONDARY}
          >
            ذخیره‌ی متن
          </button>
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-section`} className="text-xs text-muted">
            بخش
          </label>
          <select
            id={`${id}-section`}
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className={`${SELECT} border-strong px-2 text-fg`}
          >
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={pending || section === item.section_id}
          onClick={() => void run(() => updateChecklistItem(item.id, { section_id: section }))}
          className={SECONDARY}
        >
          انتقال
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="ترتیب در بخش">
        <button
          type="button"
          disabled={pending || first}
          onClick={() => void run(() => moveChecklistItem(item.id, 'up'))}
          className={SECONDARY}
        >
          <span aria-hidden="true">↑</span> بالاتر
        </button>
        <button
          type="button"
          disabled={pending || last}
          onClick={() => void run(() => moveChecklistItem(item.id, 'down'))}
          className={SECONDARY}
        >
          <span aria-hidden="true">↓</span> پایین‌تر
        </button>
      </div>

      <form
        className="flex flex-col gap-2 rounded-tile border border-default p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => removeChecklistItem(item.id, reason));
        }}
      >
        <label htmlFor={`${id}-reason`} className="text-xs text-muted">
          حذف از فهرست — دلیل را بنویسید (در تاریخچه و کارنامه‌ی کنسول می‌ماند)
        </label>
        <input
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={CONSOLE_CHECKLIST_REASON_MAX}
          dir="auto"
          className={inputClass}
        />
        <div>
          <button type="submit" disabled={pending || reason.trim() === ''} className={DANGER}>
            حذف مورد
          </button>
        </div>
      </form>
    </section>
  );
}
