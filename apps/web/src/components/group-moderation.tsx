'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { GroupAppealNote, GroupQueueSubject, QueuedReport } from '@fmip/contracts';
import type { ActionState } from '@/lib/auth-actions';
import { appealGroupClosureAction } from '@/lib/group-actions';
import { type GroupDecisionKind, groupDecisionAction } from '@/lib/moderation-actions';
import { Button, Card, Checkbox, FormStatus, TextArea } from '@/components/ui';

/**
 * Administrators and groups on the web (blueprint 10.4, T-1025, D-135).
 *
 * The role and every rule are the API's; these forms send what the moderator
 * chose -- always with a reason -- and show the sentence that came back.
 */

/** Groups with open reports, in the queue beside the members. */
export function GroupModerationQueue({
  locale,
  groups,
}: {
  locale: string;
  groups: GroupQueueSubject[];
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="moderation-groups-empty">
        No report about a group is waiting.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4" data-testid="moderation-groups">
      {groups.map((group) => (
        <Card as="li" key={group.subject_id} data-testid="moderation-group-subject">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              <Link
                href={`/${locale}/admin/moderation/groups/${encodeURIComponent(group.slug)}`}
                className="font-medium underline"
                data-testid="moderation-group-link"
              >
                {group.name}
              </Link>
              <span className="ms-2 text-sm text-muted">{group.visibility}</span>
              {group.closed !== null && (
                <span className="ms-2 text-sm" data-testid="moderation-group-closed">
                  closed
                </span>
              )}
            </span>
            <span className="text-xs text-muted">
              {group.reports.length} report{group.reports.length === 1 ? '' : 's'} · waiting since{' '}
              <time dateTime={group.waiting_since}>{group.waiting_since}</time>
            </span>
          </div>
        </Card>
      ))}
    </ul>
  );
}

const DECISION_LABELS: Record<GroupDecisionKind, { title: string; button: string }> = {
  close: { title: 'Close the group', button: 'Close it' },
  reopen: { title: 'Reopen the group', button: 'Reopen it' },
  removal: { title: 'Remove its description', button: 'Remove the description' },
  dismissal: { title: 'The reports do not hold', button: 'Answer them: no action' },
};

/**
 * One decision about a group: a reason, and the open reports it answers. The
 * reason is always asked for, because every decision is audited with it
 * (rule 10).
 */
export function GroupDecisionForm({
  locale,
  slug,
  kind,
  openReports,
}: {
  locale: string;
  slug: string;
  kind: GroupDecisionKind;
  openReports: QueuedReport[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    groupDecisionAction.bind(null, locale, slug, kind),
    null,
  );
  const labels = DECISION_LABELS[kind];
  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      data-testid={`group-decision-${kind}`}
    >
      <h3 className="font-medium">{labels.title}</h3>
      <TextArea
        label="Reason (recorded, and shown to the group when it closes)"
        id={`group-decision-reason-${kind}`}
        name="reason"
        rows={2}
        maxLength={500}
        required
      />
      {openReports.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm">Reports this answers</legend>
          {openReports.map((report) => (
            <Checkbox
              key={report.id}
              name="report_id"
              value={report.id}
              defaultChecked
              label={`${report.reason} from @${report.reporter}`}
            />
          ))}
        </fieldset>
      )}
      <Button type="submit" variant="secondary" pending={pending} className="self-start">
        {labels.button}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid={`group-decision-${kind}-result`}>
          {state.ok ? (state.message ?? 'Done.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}

/** The appeal notes on a closure, oldest first. */
export function AppealNotes({ notes }: { notes: GroupAppealNote[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="group-appeal-none">
        No appeal has been written.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="group-appeal-notes">
      {notes.map((note) => (
        <li key={note.id} className="text-sm">
          <span className="text-muted">
            <time dateTime={note.created_at}>{note.created_at}</time>
          </span>{' '}
          <span className="whitespace-pre-line">{note.body}</span>
        </li>
      ))}
    </ol>
  );
}

/** The owner's appeal of a closure (T-211's notes, on the decision that closed it). */
export function GroupAppealForm({ locale, slug }: { locale: string; slug: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    appealGroupClosureAction.bind(null, locale, slug),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="group-appeal-form">
      <TextArea
        label="Why the group should be reopened"
        id="group-appeal-body"
        name="body"
        rows={4}
        maxLength={4000}
        required
      />
      <Button type="submit" variant="secondary" pending={pending} className="self-start">
        Send the appeal
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid="group-appeal-result">
          {state.ok ? (state.message ?? 'Sent.') : state.message}
        </FormStatus>
      )}
    </form>
  );
}
