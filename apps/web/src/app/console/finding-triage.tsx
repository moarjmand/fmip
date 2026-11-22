'use client';

import { type ReactNode, useActionState, useEffect, useRef, useState } from 'react';
import type { ConsoleFindingCommandKind } from '@fmip/contracts';
import {
  CONSOLE_REJECT_REASON_MIN,
  CONSOLE_SYNC_TIME_ZONE,
  dayToIso,
  isoToDay,
} from '@fmip/contracts/console';
import { type ConsoleFormState, triageFinding } from '@/lib/console-actions';
import type { TriageGroup } from './triage';

/**
 * A finding's triage, on its row and on its own page (T-1908, D-456 point 2).
 * The one client part: three buttons («قبول», «رد…» with its reason, «به
 * تعویق…» with its days), each a `<button>` in a form posted to the
 * `triageFinding` server action, and what the finding says once someone has
 * decided. The server words everything that is a date or a time and hands it
 * over in `TriageView`; nothing here reads a clock.
 *
 * What is shown follows the snapshot alone. A command that waits is said as
 * waiting, with the next sync, and the finding keeps the status the snapshot
 * has: never a finished state before the computer has applied it.
 *
 * Focus: opening «رد…» moves it to the reason field, «به تعویق…» to the
 * first day and «همین حالا تصمیم بگیرم» to «قبول»; closing a form returns it to the button that opened it; after a
 * command is taken or refused it rests on the row's outcome line, so a
 * keyboard or screen-reader user is not dropped at the top of the page when
 * the buttons give way to the waiting state.
 */

export interface TriagePendingView {
  commandId: string;
  kind: ConsoleFindingCommandKind;
  /** Who asked and when, worded: «مریم · ۲ آذر، ۱۰:۱۵». */
  asked: string;
  /** A snooze's day, worded; null otherwise. */
  until: string | null;
  /** The computer has it: it can no longer be withdrawn. */
  taken: boolean;
}

export interface TriageView {
  id: string;
  group: TriageGroup;
  /** Why this account may not triage it (a security finding and not the owner); null when it may. */
  refusal: string | null;
  pending: TriagePendingView | null;
  /** When the computer may apply a waiting command, as the heartbeat lets it be said. */
  nextSync: string;
  /** Accepted: the task row's id once the snapshot carries it. */
  task: string | null;
  /** Accepted, a security finding: drafted privately on the computer, no public row. */
  privateTask: boolean;
  /** Rejected: the person's reason, or null when the snapshot does not carry it. */
  reason: string | null;
  /** Snoozed: the wake day, worded. */
  until: string | null;
  /** Who decided (console username), when the snapshot says. */
  by: string | null;
  snooze: {
    /** «فردا · ۲ آذر» and its day. */
    choices: { label: string; until: string }[];
    /**
     * The first and the last day a snooze may name, YYYY-MM-DD. The list
     * between them is built here, in the browser, when the form opens: up to
     * 90 worded days a row would otherwise travel with every finding of a
     * list that is not paged.
     */
    min: string;
    max: string;
    limit: string;
  };
}

const BUTTON =
  'inline-flex min-h-touch items-center justify-center rounded-control px-4 text-sm font-bold disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const PRIMARY = `${BUTTON} bg-brand text-on-brand`;
const SECONDARY = `${BUTTON} border border-strong bg-canvas text-fg`;
const QUIET =
  'inline-flex min-h-9 items-center rounded-control px-3 text-sm text-muted underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60';
const FIELD =
  'w-full rounded-control border border-strong bg-canvas px-3 py-2 text-sm text-fg focus:outline-2 focus:outline-focus';

const PENDING_TITLE: Record<ConsoleFindingCommandKind, string> = {
  'finding.accept': 'پذیرفته · در انتظار',
  'finding.reject': 'رد · در انتظار',
  'finding.snooze': 'تعویق · در انتظار',
};
const PENDING_WHAT: Record<ConsoleFindingCommandKind, string> = {
  'finding.accept': 'قبول',
  'finding.reject': 'رد',
  'finding.snooze': 'تعویق',
};

type Open = 'reject' | 'snooze' | null;

/** A day as «شنبه ۳ آذر», in the Solar Hijri calendar and Tehran's day. */
const dayWords = new Intl.DateTimeFormat('fa-IR', {
  timeZone: CONSOLE_SYNC_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Every day from `min` to `max`, worded; never more than the API's longest snooze. */
export function snoozeDayOptions(min: string, max: string): { label: string; until: string }[] {
  const [first, last] = [isoToDay(min), isoToDay(max)];
  if (first === null || last === null) return [];
  return Array.from({ length: Math.min(Math.max(0, last - first + 1), 90) }, (_, index) => {
    const until = dayToIso(first + index);
    return { until, label: dayWords.format(new Date(`${until}T12:00:00Z`)) };
  });
}

/**
 * The triage card of a finding's own page. Below 768 px it is a bar fixed to
 * the bottom of the window while there is something to decide or to wait
 * for; its height changes with the form that is open, so it tells the page
 * (`--triage-bar` on the document) how much room to leave under the content,
 * and the last lines are never left behind it.
 */
export function TriageBar({
  fixed,
  labelledBy,
  children,
}: {
  fixed: boolean;
  labelledBy: string;
  children: ReactNode;
}) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!fixed || element === null || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const tell = () => root.style.setProperty('--triage-bar', `${element.offsetHeight}px`);
    const observer = new ResizeObserver(tell);
    observer.observe(element);
    tell();
    return () => {
      observer.disconnect();
      root.style.removeProperty('--triage-bar');
    };
  }, [fixed]);
  return (
    <section
      ref={bar}
      aria-labelledby={labelledBy}
      className={
        fixed
          ? 'fixed start-0 end-0 bottom-0 z-20 max-h-[70dvh] overflow-y-auto border-t border-strong bg-surface p-3 md:static md:z-auto md:max-h-none md:overflow-visible md:rounded-card md:border md:border-default md:p-5'
          : 'rounded-card border border-default bg-surface p-4 md:p-5'
      }
      data-triage-card={fixed ? 'fixed' : 'static'}
    >
      {children}
    </section>
  );
}

export function FindingTriage({ view, labelledBy }: { view: TriageView; labelledBy?: string }) {
  const [state, run, busy] = useActionState<ConsoleFormState, FormData>(triageFinding, {
    error: null,
    done: null,
  });
  // What the person opened, and under which answer of the server: a new answer that took the
  // command closes the form by itself, and a refusal leaves it open with what was typed.
  const [choice, setChoice] = useState<{ under: ConsoleFormState; open: Open; deciding: boolean }>({
    under: state,
    open: null,
    deciding: false,
  });
  const current = choice.under === state || state.done === null;
  const open: Open = current ? choice.open : null;
  const deciding = current && choice.deciding;
  const setOpen = (next: Open) => setChoice({ under: state, open: next, deciding });
  const reason = useRef<HTMLTextAreaElement>(null);
  const firstDay = useRef<HTMLButtonElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const snoozeButton = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const opened = useRef<Open>(null);

  // Into the form that opened; back to its button when it closes by hand.
  useEffect(() => {
    if (open === 'reject') reason.current?.focus();
    else if (open === 'snooze') firstDay.current?.focus();
    else if (opened.current === 'reject') rejectButton.current?.focus();
    else if (opened.current === 'snooze') snoozeButton.current?.focus();
    opened.current = open;
  }, [open]);

  // «همین حالا تصمیم بگیرم» gives way to the three buttons: focus goes to the first of them.
  useEffect(() => {
    if (deciding) acceptButton.current?.focus();
  }, [deciding]);

  // An answer from the server: focus rests on the outcome (after the effect above, which may
  // have sent it to a button that is about to give way to the waiting state).
  useEffect(() => {
    if (state.error === null && state.done === null) return;
    outcome.current?.focus();
  }, [state]);

  const { pending } = view;
  // The success line belongs to the command that waits (or to its withdrawal); once the
  // snapshot has moved on it would be an old sentence about a new state.
  const done =
    state.done !== null && (pending !== null || state.id === 'withdrawn') ? state.done : null;
  const mayDecide =
    pending === null &&
    view.refusal === null &&
    (view.group === 'needs' || (view.group === 'snoozed' && deciding));

  return (
    <div
      className="flex flex-col gap-2 text-sm"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy === undefined ? 'تصمیم درباره‌ی این یافته' : undefined}
      data-triage={view.id}
    >
      {pending !== null && (
        <div className="rounded-tile border border-dashed border-strong bg-surface-raised p-3">
          <p className="font-bold text-fg">
            {PENDING_TITLE[pending.kind]}
            {pending.until !== null && <span className="font-normal"> · تا {pending.until}</span>}
          </p>
          <p className="mt-1 text-muted">
            {PENDING_WHAT[pending.kind]} ثبت شده، ولی رایانه هنوز آن را انجام نداده است.{' '}
            {pending.taken
              ? 'رایانه دستور را برداشته و در حال انجام آن است؛ نتیجه با هم‌گام‌سازی بعدی همین‌جا می‌آید.'
              : view.nextSync}{' '}
            تا آن‌وقت وضعیت یافته همان است که بود.
          </p>
          {pending.kind === 'finding.accept' && (
            <p className="mt-1 text-xs text-caption">
              ردیف کار هنوز ساخته نشده است؛ شناسه‌اش بعد از ساخته‌شدن همین‌جا می‌آید.
            </p>
          )}
          <p className="mt-1 text-xs text-caption">{pending.asked}</p>
          {pending.taken ? (
            <p className="mt-2 text-xs text-caption">دیگر نمی‌شود از این دستور انصراف داد.</p>
          ) : (
            <form action={run} className="mt-2">
              <input type="hidden" name="kind" value="withdraw" />
              <input type="hidden" name="command" value={pending.commandId} />
              <button type="submit" disabled={busy} className={QUIET}>
                انصراف از این دستور
              </button>
            </form>
          )}
        </div>
      )}

      {pending === null && view.group === 'accepted' && (
        <div className="rounded-tile bg-surface-raised p-3">
          {view.task !== null ? (
            <p className="font-bold text-fg">
              پذیرفته · ردیف کار{' '}
              <bdi dir="ltr" className="font-mono">
                {view.task}
              </bdi>
            </p>
          ) : view.privateTask ? (
            <p className="font-bold text-fg">پذیرفته · کار به‌صورت خصوصی پیش‌نویس شد</p>
          ) : (
            <p className="font-bold text-fg">پذیرفته · در انتظار</p>
          )}
          <p className="mt-1 text-muted">
            {view.task !== null
              ? 'پذیرفته یعنی ردیف کار ساخته شده است، نه اینکه کار شروع شده باشد.'
              : view.privateTask
                ? 'یافته‌ی امنیتی ردیف عمومی ندارد؛ کارش فقط روی رایانه‌ی نگهدارنده نوشته شده و هنوز شروع نشده است.'
                : 'رایانه هنوز ردیف کار را نساخته است؛ شناسه‌اش بعد از ساخته‌شدن همین‌جا می‌آید. پذیرفته یعنی کاری برایش ساخته می‌شود، نه اینکه شروع شده باشد.'}
          </p>
          {view.by !== null && <DecidedBy by={view.by} />}
        </div>
      )}

      {pending === null && view.group === 'rejected' && (
        <div className="rounded-tile bg-surface-raised p-3">
          <p className="font-bold text-fg">رد شده</p>
          {view.reason !== null ? (
            <p className="mt-1 text-muted">
              دلیل: <bdi dir="auto">{view.reason}</bdi>
            </p>
          ) : (
            <p className="mt-1 text-muted">دلیل رد در این هم‌گام‌سازی نیامده است.</p>
          )}
          {view.by !== null && <DecidedBy by={view.by} />}
          <p className="mt-2 text-xs text-caption">
            بازگشایی از کنسول هنوز ممکن نیست: رایانه برای آن دستوری نمی‌شناسد. اگر موضوع دوباره دیده
            شود، عامل یافته را خودش باز می‌کند.
          </p>
        </div>
      )}

      {pending === null && view.group === 'snoozed' && (
        <div className="rounded-tile bg-surface-raised p-3">
          <p className="font-bold text-fg">
            به تعویق افتاده
            {view.until !== null && <span> · تا {view.until}</span>}
          </p>
          <p className="mt-1 text-muted">از آن روز خودش دوباره به «نیاز به تصمیم» برمی‌گردد.</p>
          {view.by !== null && <DecidedBy by={view.by} />}
          {view.refusal === null && !deciding && (
            <button
              type="button"
              className={`${QUIET} mt-1`}
              onClick={() => setChoice({ under: state, open: null, deciding: true })}
            >
              همین حالا تصمیم بگیرم
            </button>
          )}
        </div>
      )}

      {pending === null &&
        view.refusal !== null &&
        (view.group === 'needs' || view.group === 'snoozed') && (
          <p className="rounded-tile border border-default p-3 text-muted">{view.refusal}</p>
        )}

      {mayDecide && (
        <>
          <div className="flex flex-wrap gap-2">
            <form action={run}>
              <input type="hidden" name="kind" value="finding.accept" />
              <input type="hidden" name="target" value={view.id} />
              <button ref={acceptButton} type="submit" disabled={busy} className={PRIMARY}>
                قبول
              </button>
            </form>
            <button
              ref={rejectButton}
              type="button"
              disabled={busy}
              aria-expanded={open === 'reject'}
              className={SECONDARY}
              onClick={() => setOpen(open === 'reject' ? null : 'reject')}
            >
              رد…
            </button>
            <button
              ref={snoozeButton}
              type="button"
              disabled={busy}
              aria-expanded={open === 'snooze'}
              className={SECONDARY}
              onClick={() => setOpen(open === 'snooze' ? null : 'snooze')}
            >
              به تعویق…
            </button>
          </div>

          {open === 'reject' && (
            <form
              action={run}
              className="flex flex-col gap-2 rounded-tile border border-default p-3"
            >
              <input type="hidden" name="kind" value="finding.reject" />
              <input type="hidden" name="target" value={view.id} />
              <label className="flex flex-col gap-1">
                <span className="font-bold text-fg">دلیل رد</span>
                <span className="text-xs text-caption">
                  دست‌کم {new Intl.NumberFormat('fa-IR').format(CONSOLE_REJECT_REASON_MIN)} نویسه؛
                  روی یافته می‌ماند و عامل‌ها آن را می‌خوانند.
                </span>
                <textarea
                  ref={reason}
                  name="reason"
                  required
                  minLength={CONSOLE_REJECT_REASON_MIN}
                  maxLength={500}
                  rows={3}
                  dir="auto"
                  className={FIELD}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy} className={PRIMARY}>
                  {busy ? '…' : 'ثبت رد'}
                </button>
                <button type="button" className={SECONDARY} onClick={() => setOpen(null)}>
                  بستن
                </button>
              </div>
            </form>
          )}

          {open === 'snooze' && (
            <div className="flex flex-col gap-3 rounded-tile border border-default p-3">
              <form action={run} className="flex flex-col gap-2">
                <input type="hidden" name="kind" value="finding.snooze" />
                <input type="hidden" name="target" value={view.id} />
                <span className="font-bold text-fg">تا چه روزی؟</span>
                <div className="flex flex-wrap gap-2">
                  {view.snooze.choices.map((choice, index) => (
                    <button
                      key={choice.until}
                      ref={index === 0 ? firstDay : undefined}
                      type="submit"
                      name="until"
                      value={choice.until}
                      disabled={busy}
                      className={SECONDARY}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </form>
              <form action={run} className="flex flex-col gap-2">
                <input type="hidden" name="kind" value="finding.snooze" />
                <input type="hidden" name="target" value={view.id} />
                <label className="flex flex-col gap-1">
                  <span className="font-bold text-fg">یا یک تاریخ دیگر</span>
                  <span className="text-xs text-caption">{view.snooze.limit}</span>
                  <select name="until" required defaultValue="" className={`${FIELD} min-h-touch`}>
                    <option value="" disabled>
                      روز را انتخاب کنید
                    </option>
                    {snoozeDayOptions(view.snooze.min, view.snooze.max).map((day) => (
                      <option key={day.until} value={day.until}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy} className={PRIMARY}>
                    {busy ? '…' : 'ثبت تعویق'}
                  </button>
                  <button type="button" className={SECONDARY} onClick={() => setOpen(null)}>
                    بستن
                  </button>
                </div>
              </form>
            </div>
          )}
        </>
      )}

      <div ref={outcome} tabIndex={-1} className="outline-none focus-visible:outline-none">
        {state.error !== null && (
          <p role="alert" className="rounded-tile border border-danger p-2 text-danger">
            {state.error}
          </p>
        )}
        <p role="status" aria-live="polite" className="text-success">
          {state.error === null && done}
        </p>
      </div>
    </div>
  );
}

function DecidedBy({ by }: { by: string }) {
  return (
    <p className="mt-1 text-xs text-caption">
      تصمیم از:{' '}
      <bdi dir="ltr" className="font-mono">
        {by}
      </bdi>
    </p>
  );
}
