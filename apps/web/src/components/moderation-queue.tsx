'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  MODERATION_OUTCOMES,
  SANCTION_SCOPES,
  type LanguageModelState,
  type ModerationOutcome,
  type QueueSubject,
  type QueuedReport,
} from '@fmip/contracts';
import { decideModerationAction, suggestModerationAction } from '@/lib/moderation-actions';
import {
  Button,
  Card,
  Checkbox,
  FormStatus,
  Notice,
  Radio,
  Select,
  TextArea,
  TextField,
} from '@/components/ui';

/**
 * The moderation queue (blueprint 10.4 and 16, T-610).
 *
 * **One card per member, not per report.** Three members reporting one person
 * is three reports and one judgement; the API groups them and this keeps the
 * grouping, so one decision answers them all.
 *
 * **The assistant's suggestion is shown as the model's and nothing more**
 * (D-070): labelled with the model, beside the report, and never pre-filling
 * the decision. A moderator who has not read the report is not helped by a
 * form that already agrees with a machine.
 */

const OUTCOME_LABELS: Record<ModerationOutcome, string> = {
  no_action: 'No action: the report does not hold',
  warned: 'Warn the member',
  content_removed: 'Remove the content',
  sanctioned: 'Restrict the member',
};

const SCOPE_LABELS: Record<(typeof SANCTION_SCOPES)[number], string> = {
  contact: 'Friend requests',
  messaging: 'Messaging',
};

function Suggest({ locale, report }: { locale: string; report: QueuedReport }) {
  const [state, formAction, pending] = useActionState(
    suggestModerationAction.bind(null, locale, report.id),
    null,
  );
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <Button
        type="submit"
        size="xs"
        pending={pending}
        pendingLabel="Asking…"
        data-testid={`moderation-suggest-${report.id}`}
        className="self-start"
      >
        {report.suggestion === null ? 'Ask for a suggestion' : 'Ask again'}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} size="xs">
          {state.message}
        </FormStatus>
      )}
    </form>
  );
}

function ReportItem({
  locale,
  report,
  assistant,
}: {
  locale: string;
  report: QueuedReport;
  assistant: LanguageModelState;
}) {
  return (
    <li
      className="flex flex-col gap-1 border-s-2 border-s-default ps-3 text-sm"
      data-testid="moderation-report"
    >
      <p>
        <span className="font-medium">{report.reason}</span>
        <span className="ms-2 text-muted">
          by{' '}
          <Link href={`/${locale}/u/${encodeURIComponent(report.reporter)}`} className="underline">
            {report.reporter}
          </Link>
        </span>
        <time className="ms-2 text-xs text-muted" dateTime={report.created_at}>
          {report.created_at}
        </time>
      </p>
      {report.detail !== null && <p className="whitespace-pre-wrap text-muted">{report.detail}</p>}
      {report.suggestion !== null ? (
        <p className="text-xs" data-testid="moderation-suggestion">
          <span className="font-medium">
            Suggested by {report.suggestion.model} (a model, not a finding):
          </span>{' '}
          {report.suggestion.category} — {report.suggestion.reasoning}
        </p>
      ) : null}
      {assistant.state === 'configured' && <Suggest locale={locale} report={report} />}
    </li>
  );
}

function Decide({ locale, subject }: { locale: string; subject: QueueSubject }) {
  const [state, formAction, pending] = useActionState(
    decideModerationAction.bind(null, locale, subject.username),
    null,
  );
  const [outcome, setOutcome] = useState<ModerationOutcome>('no_action');
  const [permanent, setPermanent] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="moderation-decide">
      {subject.reports.map((report) => (
        <input key={report.id} type="hidden" name="report_id" value={report.id} />
      ))}
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium">Decision</legend>
        {MODERATION_OUTCOMES.map((value) => (
          <Radio
            key={value}
            label={OUTCOME_LABELS[value]}
            name="outcome"
            value={value}
            checked={outcome === value}
            onChange={() => setOutcome(value)}
          />
        ))}
      </fieldset>

      {outcome === 'sanctioned' && (
        <fieldset
          className="flex flex-wrap items-end gap-3 text-sm"
          data-testid="moderation-sanction"
        >
          <legend className="font-medium">Restriction</legend>
          <Select label="What it restricts" name="scope" size="sm">
            {SANCTION_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {SCOPE_LABELS[scope]}
              </option>
            ))}
          </Select>
          <TextField
            label="Days"
            type="number"
            name="days"
            min={1}
            defaultValue={7}
            disabled={permanent}
            size="sm"
            controlClassName="w-24"
          />
          <Checkbox
            label="Permanent"
            name="permanent"
            checked={permanent}
            onChange={(event) => setPermanent(event.target.checked)}
          />
        </fieldset>
      )}

      <TextArea
        label="Why"
        name="reason"
        rows={2}
        required
        placeholder="Say why. This is recorded with your name."
      />
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Recording…"
        data-testid={`moderation-decide-${subject.username}`}
        className="self-start"
      >
        {`Decide on ${subject.reports.length} report${subject.reports.length === 1 ? '' : 's'}`}
      </Button>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid={`moderation-decide-result-${subject.username}`}>
          {state.message}
          {!state.ok && state.fields !== undefined && (
            <span className="block">
              {Object.entries(state.fields)
                .map(([field, problem]) => `${field}: ${problem}`)
                .join('; ')}
            </span>
          )}
        </FormStatus>
      )}
    </form>
  );
}

export function ModerationQueue({
  locale,
  subjects,
  assistant,
  openTotal,
  reachable,
}: {
  locale: string;
  subjects: QueueSubject[];
  assistant: LanguageModelState;
  openTotal: number;
  /** False when the queue could not be fetched at all. */
  reachable: boolean;
}) {
  if (!reachable) {
    // "Cannot be shown" and "nothing waiting" are different facts; a moderator
    // shown the second when the first was true would go home.
    return (
      <Notice tone="danger" data-testid="moderation-queue-unreachable">
        The moderation queue cannot be shown right now.
      </Notice>
    );
  }

  if (subjects.length === 0) {
    return (
      <p className="text-sm text-muted" data-testid="moderation-queue-empty">
        No report about a member is waiting.
      </p>
    );
  }

  const shown = subjects.reduce((sum, subject) => sum + subject.reports.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted" data-testid="moderation-queue-count">
        {openTotal} open report{openTotal === 1 ? '' : 's'}
        {shown < openTotal ? `; the oldest ${shown} are shown` : ''}.{' '}
        {assistant.state === 'absent'
          ? 'No language model is configured, so there are no suggestions.'
          : `Suggestions come from ${assistant.model}; they are never decisions.`}
      </p>
      <ul className="flex flex-col gap-4" data-testid="moderation-queue">
        {subjects.map((subject) => (
          <Card
            as="li"
            key={`${subject.subject_type}:${subject.subject_id}`}
            data-testid="moderation-queue-subject"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <Link
                  href={`/${locale}/u/${encodeURIComponent(subject.username)}`}
                  className="font-medium underline"
                >
                  {subject.display_name}
                </Link>
                <span className="ms-2 text-sm text-muted">@{subject.username}</span>
                <Link
                  href={`/${locale}/admin/moderation/${encodeURIComponent(subject.username)}`}
                  className="ms-2 text-sm underline"
                  data-testid="moderation-history-link"
                >
                  History
                </Link>
                {subject.active_sanctions > 0 && (
                  <span className="ms-2 text-sm" data-testid="moderation-active-sanctions">
                    {subject.active_sanctions} restriction
                    {subject.active_sanctions === 1 ? '' : 's'} in force
                  </span>
                )}
              </span>
              <span className="text-xs text-muted">
                waiting since <time dateTime={subject.waiting_since}>{subject.waiting_since}</time>
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {subject.reports.map((report) => (
                <ReportItem key={report.id} locale={locale} report={report} assistant={assistant} />
              ))}
            </ul>
            <Decide locale={locale} subject={subject} />
          </Card>
        ))}
      </ul>
    </div>
  );
}
