/**
 * The calendar event's form in the console's side panel (T-1788, D-391): add, edit, and a guarded delete.
 */
import type { ConsoleCalendarEvent, ConsoleEventBasis, ConsoleEventColor } from '@fmip/contracts';
import {
  CONSOLE_EVENT_COLORS,
  CONSOLE_EVENT_NOTE_MAX,
  CONSOLE_EVENT_TITLE_MAX,
  dayToJalali,
  isoToDay,
} from '@fmip/contracts/console';
import { deleteEvent, saveEvent } from '@/lib/console-actions';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { ConsoleForm } from './console-form';
import {
  COLOR_WORDS,
  MONTHS_J,
  REMIND_WORDS,
  REPEAT_WORDS,
  bothDates,
  colorStyle,
  faInt,
} from './calendar';
import { inputClass } from './ui';

/** What the editor opens with: an event to change, or a new one's draft. */
export interface EventDraft {
  id: string | null;
  title: string;
  date: string;
  time: string | null;
  repeat: ConsoleCalendarEvent['repeat'];
  basis: ConsoleEventBasis;
  repeat_until: string | null;
  remind_minutes: number | null;
  note: string;
  color: ConsoleEventColor;
  subscription_key: string | null;
  updated_by?: string | null;
}

export const blankDraft = (date: string, basis: ConsoleEventBasis): EventDraft => ({
  id: null,
  title: '',
  date,
  time: null,
  repeat: 'none',
  basis,
  repeat_until: null,
  remind_minutes: null,
  note: '',
  color: 'blue',
  subscription_key: null,
});

const label = 'text-xs font-bold text-muted';

/**
 * The event's form (T-1788, D-391), in the side panel: a server action saves
 * it and returns to the calendar on its day. The day is picked in the
 * calendar the page is in: day, month and year for Solar Hijri, the browser's
 * date field for Gregorian. Removing asks once more, inside a disclosure.
 */
export function EventEditor({
  draft,
  basis,
  back,
  closeHref,
  subscriptionName,
}: {
  draft: EventDraft;
  basis: ConsoleEventBasis;
  back: string;
  closeHref: string;
  subscriptionName: string | null;
}) {
  const day = isoToDay(draft.date) ?? 0;
  const j = dayToJalali(day);
  const isNew = draft.id === null;
  return (
    <section
      aria-labelledby="event-editor-title"
      className="rounded-card border border-brand bg-surface p-4 shadow-sm"
      style={colorStyle(draft.color)}
      data-testid="event-editor"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="event-editor-title" className="text-base font-bold">
          {isNew ? 'رویداد یا یادآور تازه' : 'ویرایش رویداد'}
        </h2>
        <Link
          href={closeHref}
          className="inline-flex min-h-touch items-center rounded-control px-3 text-sm text-muted hover:bg-surface-raised hover:text-fg"
        >
          بستن
        </Link>
      </div>
      <ConsoleForm action={saveEvent} submit={isNew ? 'افزودن به تقویم' : 'ذخیره'}>
        <input type="hidden" name="id" value={draft.id ?? ''} />
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="calendar" value={basis} />
        <input type="hidden" name="subscription_key" value={draft.subscription_key ?? ''} />
        {subscriptionName !== null && (
          <p className="rounded-control bg-surface-raised px-3 py-2 text-xs text-muted">
            یادآور تمدید <bdi dir="auto">{subscriptionName}</bdi>
          </p>
        )}
        <label className="flex flex-col gap-1">
          <span className={label}>عنوان</span>
          <input
            name="title"
            required
            maxLength={CONSOLE_EVENT_TITLE_MAX}
            defaultValue={draft.title}
            placeholder="مثلاً جلسهٔ هفتگی تیم"
            dir="auto"
            autoFocus={isNew}
            className={inputClass}
          />
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className={label}>تاریخ {basis === 'j' ? '(شمسی)' : '(میلادی)'}</legend>
          {basis === 'j' ? (
            <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2">
              <label>
                <span className="sr-only">روز</span>
                <select name="jd" defaultValue={String(j.d)} className={inputClass}>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {faInt(i + 1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">ماه</span>
                <select name="jm" defaultValue={String(j.m)} className={inputClass}>
                  {MONTHS_J.map((name, i) => (
                    <option key={name} value={i + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">سال</span>
                <input
                  name="jy"
                  type="number"
                  min={1300}
                  max={1500}
                  defaultValue={j.y}
                  inputMode="numeric"
                  className={inputClass}
                />
              </label>
            </div>
          ) : (
            <input
              name="date"
              type="date"
              required
              defaultValue={draft.date}
              className={inputClass}
            />
          )}
          <span className="text-xs text-caption">{bothDates(basis, day)}</span>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>ساعت</span>
            <input name="time" type="time" defaultValue={draft.time ?? ''} className={inputClass} />
            <span className="text-xs text-caption">خالی یعنی همهٔ روز؛ به وقت تهران</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>یادآوری</span>
            <select
              name="remind_minutes"
              defaultValue={draft.remind_minutes === null ? '' : String(draft.remind_minutes)}
              className={inputClass}
            >
              {Object.entries(REMIND_WORDS).map(([value, words]) => (
                <option key={value} value={value}>
                  {words}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>تکرار</span>
            <select name="repeat" defaultValue={draft.repeat} className={inputClass}>
              {Object.entries(REPEAT_WORDS).map(([value, words]) => (
                <option key={value} value={value}>
                  {words}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>ماهانه و سالانه بر پایهٔ</span>
            <select name="basis" defaultValue={draft.basis} className={inputClass}>
              <option value="j">تقویم شمسی</option>
              <option value="g">تقویم میلادی</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className={label}>تکرار تا (میلادی، اختیاری)</span>
            <input
              name="repeat_until"
              type="date"
              defaultValue={draft.repeat_until ?? ''}
              className={inputClass}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className={label}>رنگ</legend>
          <div className="flex flex-wrap gap-2">
            {CONSOLE_EVENT_COLORS.map((color) => (
              <label
                key={color}
                className="relative inline-grid size-9 cursor-pointer place-items-center"
                style={colorStyle(color)}
              >
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={draft.color === color}
                  className="peer absolute inset-0 cursor-pointer opacity-0"
                />
                <span
                  aria-hidden="true"
                  className="size-7 rounded-pill bg-[var(--ev)] ring-offset-2 ring-offset-[var(--color-surface)] peer-checked:ring-2 peer-checked:ring-[var(--ev)] peer-focus-visible:outline-2 peer-focus-visible:outline-focus"
                />
                <span className="sr-only">{COLOR_WORDS[color]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className={label}>یادداشت</span>
          <textarea
            name="note"
            rows={4}
            maxLength={CONSOLE_EVENT_NOTE_MAX}
            defaultValue={draft.note}
            dir="auto"
            className={`${inputClass} py-2 leading-7`}
          />
        </label>
      </ConsoleForm>

      {!isNew && (
        <details className="mt-4 border-t border-default pt-3">
          <summary className="inline-flex min-h-touch cursor-pointer items-center text-sm text-danger">
            حذف این رویداد
          </summary>
          <ConsoleForm
            action={deleteEvent}
            submit="بله، حذف شود"
            className="mt-2 flex flex-col gap-2"
            submitClassName="min-h-touch rounded-control border border-danger px-4 text-sm font-bold text-danger"
          >
            <input type="hidden" name="id" value={draft.id ?? ''} />
            <input type="hidden" name="back" value={back} />
            <p className="text-xs text-muted">
              رویداد از تقویم برداشته می‌شود و یادآورش دیگر نمی‌رسد؛ در کارنامهٔ کنسول می‌ماند.
            </p>
          </ConsoleForm>
        </details>
      )}
      {!isNew && draft.updated_by !== undefined && draft.updated_by !== null && (
        <p className="mt-3 text-xs text-caption">
          آخرین ویرایش: <bdi>{draft.updated_by}</bdi>
        </p>
      )}
    </section>
  );
}
