import {
  CONSOLE_DECISION_TEXT_MAX,
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_TITLE_MAX,
  type ConsoleDecisionChoice,
  type ConsoleRequestDetail,
  type ConsoleRequestEvent,
  type ConsoleRequestStatus,
} from '@fmip/contracts';
import { decideRequest, editRequest, requestAction } from '@/lib/console-actions';
import { ConsoleForm } from './console-form';
import { Badge, fa, inputClass, when } from './ui';

/**
 * Teammate requests (T-1728, D-354), drawn on the server: each request as a
 * card, the request at the start and Claude's result box at the end (stacked
 * on a phone), the question for the teammate with its three answers while it
 * is open, the actions, and the history. Nothing here runs a request:
 * Claude acts on one only on the maintainer's word in his own chat.
 */

export const REQUEST_STATUS_WORDS: Record<ConsoleRequestStatus, string> = {
  new: 'تازه',
  in_progress: 'در حال انجام',
  waiting_decision: 'منتظر تصمیم',
  decided: 'تصمیم گرفته شد',
  done: 'انجام‌شده',
  cancelled: 'لغوشده',
};

const STATUS_TONE: Record<ConsoleRequestStatus, string> = {
  new: 'border-brand text-brand',
  in_progress: 'border-accent text-fg',
  waiting_decision: 'border-warning text-warning',
  decided: 'border-brand text-fg',
  done: 'border-success text-success',
  cancelled: 'border-default text-caption',
};

/** The buttons' words, as a console user says them. */
export const CHOICE_WORDS: Record<ConsoleDecisionChoice, string> = {
  approve: 'موافقم',
  reject: 'مخالفم',
  other: 'نظر دیگر',
};

/** A recorded decision, as the card says it. */
const DECIDED_WORDS: Record<ConsoleDecisionChoice, string> = {
  approve: 'موافق',
  reject: 'مخالف',
  other: 'نظر دیگر',
};

const OPEN: readonly ConsoleRequestStatus[] = ['new', 'in_progress', 'waiting_decision', 'decided'];

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
const SECONDARY = `min-h-touch rounded-control border border-strong bg-surface px-3 text-sm text-fg hover:bg-surface-raised disabled:opacity-60 ${FOCUS}`;
const QUIET = `min-h-touch rounded-control px-3 text-sm text-muted hover:text-danger disabled:opacity-60 ${FOCUS}`;
const PRIMARY = `min-h-touch rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 ${FOCUS}`;

/** Who did a history line: the console user's name, or Claude. */
const actorOf = (event: ConsoleRequestEvent) =>
  event.actor_kind === 'agent' ? 'Claude' : event.actor;

/** A decision's history note is `choice` or `choice: text` (the store writes it so). */
export function decisionNote(
  note: string | null,
): { choice: ConsoleDecisionChoice; text: string | null } | null {
  const match = /^(approve|reject|other)(?:: ([\s\S]*))?$/.exec(note ?? '');
  if (match === null) return null;
  return { choice: match[1] as ConsoleDecisionChoice, text: match[2] ?? null };
}

/** What one history line says, in Persian. */
export function eventWords(event: ConsoleRequestEvent): string {
  const to = event.to_status === null ? '' : REQUEST_STATUS_WORDS[event.to_status];
  switch (event.kind) {
    case 'created':
      return 'درخواست را ثبت کرد';
    case 'edited':
      return 'درخواست را ویرایش کرد';
    case 'cancelled':
      return 'درخواست را لغو کرد';
    case 'reopened':
      return 'درخواست را بازگشایی کرد';
    case 'execute_requested':
      return 'برای اجرا علامت زد';
    case 'execute_withdrawn':
      return 'علامت اجرا را برداشت';
    case 'asked':
      return 'برای هم‌تیمی پرسش گذاشت';
    case 'decided': {
      const decision = decisionNote(event.note);
      return decision === null ? 'تصمیم گرفت' : `تصمیم گرفت: ${DECIDED_WORDS[decision.choice]}`;
    }
    case 'result':
      return `نتیجه نوشت؛ وضعیت: ${to}`;
  }
}

function ResultBox({ request }: { request: ConsoleRequestDetail }) {
  return (
    <section
      aria-label="نتیجه‌ی پیگیری"
      className="flex min-h-full flex-col gap-2 rounded-tile border border-default bg-surface-raised p-3"
      data-testid="result-box"
    >
      <h3 className="text-xs font-bold text-muted">نتیجه‌ی پیگیری</h3>
      {request.result === null ? (
        <p className="text-sm text-caption">هنوز نتیجه‌ای ثبت نشده</p>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-sm text-fg" dir="auto">
            {request.result}
          </p>
          <p className="mt-auto text-xs text-caption">Claude · {when(request.result_at)}</p>
        </>
      )}
    </section>
  );
}

function DecisionPanel({ request }: { request: ConsoleRequestDetail }) {
  const question = request.decision_question;
  if (question === null) return null;
  const open = request.status === 'waiting_decision';
  const decided = request.decision_choice !== null;
  const tone = open
    ? 'border-warning bg-canvas'
    : decided
      ? 'border-success bg-canvas'
      : 'border-default bg-canvas';
  return (
    <section
      aria-label="تصمیم هم‌تیمی"
      className={`flex flex-col gap-3 rounded-tile border-2 p-3 ${tone}`}
      data-testid="decision-panel"
      data-state={open ? 'open' : decided ? 'decided' : 'unanswered'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-fg">
          {open ? 'منتظر تصمیم هم‌تیمی' : decided ? 'تصمیم هم‌تیمی' : 'پرسش بی‌پاسخ ماند'}
        </h3>
        {request.decision_asked_at !== null && (
          <span className="text-xs text-caption">پرسیده شد {when(request.decision_asked_at)}</span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-fg" dir="auto">
        {question}
      </p>
      {open && (
        <ConsoleForm
          action={decideRequest}
          submit="ثبت تصمیم"
          className="flex flex-col gap-2"
          buttons={[
            {
              name: 'choice',
              value: 'approve',
              label: CHOICE_WORDS.approve,
              className: `min-h-touch rounded-control border border-success bg-surface px-4 text-sm font-bold text-success hover:bg-surface-raised disabled:opacity-60 ${FOCUS}`,
            },
            {
              name: 'choice',
              value: 'reject',
              label: CHOICE_WORDS.reject,
              className: `min-h-touch rounded-control border border-danger bg-surface px-4 text-sm font-bold text-danger hover:bg-surface-raised disabled:opacity-60 ${FOCUS}`,
            },
            { name: 'choice', value: 'other', label: CHOICE_WORDS.other, className: SECONDARY },
          ]}
        >
          <input type="hidden" name="id" value={request.id} />
          <label className="flex flex-col gap-1 text-xs text-muted">
            توضیح شما (برای «نظر دیگر» لازم است)
            <textarea
              name="text"
              rows={3}
              maxLength={CONSOLE_DECISION_TEXT_MAX}
              dir="auto"
              className={`${inputClass} py-2`}
            />
          </label>
        </ConsoleForm>
      )}
      {decided && (
        <div className="flex flex-col gap-1 border-t border-default pt-2">
          <p className="text-sm">
            <Badge tone="border-success text-success">
              {DECIDED_WORDS[request.decision_choice!]}
            </Badge>{' '}
            <span className="text-xs text-caption">
              <span dir="auto">{request.decision_by ?? ''}</span> · {when(request.decided_at)}
            </span>
          </p>
          {request.decision_text !== null && (
            <p className="whitespace-pre-wrap break-words text-sm text-fg" dir="auto">
              {request.decision_text}
            </p>
          )}
          {request.status === 'decided' && (
            <p className="text-xs text-caption">
              Claude پس از گفتهٔ نگهدارنده در گفتگو آن را اجرا می‌کند.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  id,
  action,
  label,
  className,
}: {
  id: string;
  action: string;
  label: string;
  className: string;
}) {
  return (
    <ConsoleForm
      action={requestAction}
      submit={label}
      submitClassName={className}
      className="contents"
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
    </ConsoleForm>
  );
}

function Actions({ request }: { request: ConsoleRequestDetail }) {
  const open = OPEN.includes(request.status);
  const marked = request.execute_requested_at !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {open && !marked && request.status !== 'waiting_decision' && (
        <ActionButton id={request.id} action="execute" label="اجرا شود" className={PRIMARY} />
      )}
      {marked && (
        <ActionButton
          id={request.id}
          action="withdraw"
          label="برداشتن از صف اجرا"
          className={SECONDARY}
        />
      )}
      {open ? (
        <ActionButton id={request.id} action="cancel" label="لغو" className={QUIET} />
      ) : (
        <ActionButton id={request.id} action="reopen" label="بازگشایی" className={SECONDARY} />
      )}
    </div>
  );
}

function EditForm({ request }: { request: ConsoleRequestDetail }) {
  return (
    <details className="group">
      <summary
        className={`inline-flex min-h-touch cursor-pointer items-center rounded-control px-2 text-sm text-brand ${FOCUS}`}
      >
        ویرایش
      </summary>
      <ConsoleForm action={editRequest} submit="ذخیره" className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="id" value={request.id} />
        <label className="flex flex-col gap-1 text-xs text-muted">
          عنوان
          <input
            name="title"
            required
            maxLength={CONSOLE_REQUEST_TITLE_MAX}
            defaultValue={request.title}
            dir="auto"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          جزئیات
          <textarea
            name="body"
            rows={4}
            maxLength={CONSOLE_REQUEST_BODY_MAX}
            defaultValue={request.body}
            dir="auto"
            className={`${inputClass} py-2`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input
            type="checkbox"
            name="priority"
            value="high"
            defaultChecked={request.priority === 'high'}
            className="size-4 accent-brand"
          />
          فوری
        </label>
      </ConsoleForm>
    </details>
  );
}

function History({ events }: { events: ConsoleRequestEvent[] }) {
  return (
    <details className="group">
      <summary
        className={`inline-flex min-h-touch cursor-pointer items-center rounded-control px-2 text-sm text-muted hover:text-fg ${FOCUS}`}
      >
        تاریخچه ({fa(events.length)})
      </summary>
      <ol className="mt-2 flex flex-col gap-3 border-s-2 border-default ps-4" aria-label="تاریخچه">
        {events.map((event) => {
          const decision = event.kind === 'decided' ? decisionNote(event.note) : null;
          const note =
            event.kind === 'decided'
              ? (decision?.text ?? null)
              : event.kind === 'asked'
                ? event.note
                : null;
          return (
            <li key={event.id} className="relative flex flex-col gap-0.5 text-sm">
              <span
                aria-hidden="true"
                className={`absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full ${
                  event.actor_kind === 'agent' ? 'bg-brand' : 'bg-caption'
                }`}
              />
              <span className="text-fg">
                <span className="font-bold" dir="auto">
                  {actorOf(event)}
                </span>{' '}
                {eventWords(event)}
              </span>
              <span className="text-xs text-caption">{when(event.at)}</span>
              {note !== null && (
                <span className="line-clamp-3 whitespace-pre-wrap text-xs text-muted" dir="auto">
                  {note}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** One request: on a wide screen the request at the start and the result at the end. */
export function RequestCard({ request }: { request: ConsoleRequestDetail }) {
  const open = OPEN.includes(request.status);
  return (
    <article
      className={`flex flex-col gap-4 rounded-card border bg-surface p-4 md:p-5 ${
        request.status === 'waiting_decision' ? 'border-warning' : 'border-default'
      }`}
      aria-labelledby={`request-${request.id}`}
      data-status={request.status}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[request.status]}>{REQUEST_STATUS_WORDS[request.status]}</Badge>
            {request.priority === 'high' && <Badge tone="border-danger text-danger">فوری</Badge>}
            {request.execute_requested_at !== null && (
              <Badge tone="border-brand bg-brand text-on-brand">در صف اجرا</Badge>
            )}
          </div>
          <h2
            id={`request-${request.id}`}
            className="break-words text-base font-bold text-fg"
            dir="auto"
          >
            {request.title}
          </h2>
          {request.body !== '' && (
            <p className="whitespace-pre-wrap break-words text-sm text-muted" dir="auto">
              {request.body}
            </p>
          )}
          <p className="text-xs text-caption">
            ثبت: <span dir="auto">{request.created_by}</span> · {when(request.created_at)}
          </p>
        </div>
        <ResultBox request={request} />
      </div>
      <DecisionPanel request={request} />
      <div className="flex flex-wrap items-start justify-between gap-2 border-t border-default pt-3">
        <Actions request={request} />
        <div className="flex flex-wrap items-start gap-1">
          {open && <EditForm request={request} />}
          <History events={request.events} />
        </div>
      </div>
    </article>
  );
}
