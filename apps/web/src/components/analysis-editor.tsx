'use client';

import { useActionState } from 'react';
import type { CommunityAnalysisWorkspace, CommunitySubmission } from '@fmip/contracts';
import { saveAnalysisDraftAction, submitAnalysisAction } from '@/lib/analysis-actions';
import { Button, FormStatus, Select, TextArea, TextField } from '@/components/ui';

/**
 * The analyst's editor (blueprint 10.3, T-262).
 *
 * **The decision history is on the same page as the draft, and that is the
 * point.** An analyst asked for changes needs to see what they submitted and
 * what was said about it; a request for changes shown on its own is an
 * instruction with no context, and they would be rewriting from memory.
 *
 * **Nothing here decides whether they may submit.** The grant, the kick-off wall
 * and the "already decided" refusal all live in the database and are worded by
 * the API. A check in the browser would be a third copy, and the one that goes
 * stale first.
 */

const STATE_TEXT: Record<CommunityAnalysisWorkspace['state'], string> = {
  draft: 'Not sent yet. Nobody has seen this.',
  submitted: 'Waiting to be read.',
  approved: 'Approved.',
  changes_requested: 'An editor asked for changes. What they said is below.',
  rejected: 'An editor declined this. What they said is below.',
  published: 'Published. Anybody can read it.',
};

const DECISION_TEXT: Record<string, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Declined',
};

function Attempt({ submission }: { submission: CommunitySubmission }) {
  return (
    <li
      className="flex flex-col gap-1 rounded border border-default p-3"
      data-testid="analysis-attempt"
    >
      <span className="text-sm font-medium">Attempt {submission.attempt}</span>
      <time className="text-xs text-muted" dateTime={submission.submitted_at}>
        {submission.submitted_at}
      </time>
      {submission.review === null ? (
        // Said, not left blank. "Waiting" and "declined without a note" are
        // different things and an analyst should not have to guess which.
        <span className="text-sm text-muted" data-testid="analysis-attempt-waiting">
          Waiting to be read.
        </span>
      ) : (
        <span className="flex flex-col gap-1 text-sm" data-testid="analysis-attempt-decided">
          <span className="font-medium">
            {DECISION_TEXT[submission.review.decision] ?? submission.review.decision} by{' '}
            {submission.review.reviewer}
          </span>
          {/* The reason, always: a decision with none cannot be reviewed, and
              the API refuses to record one without it. */}
          <span className="whitespace-pre-wrap text-muted">{submission.review.reason}</span>
        </span>
      )}
    </li>
  );
}

export function AnalysisEditor({
  locale,
  fixtureId,
  workspace,
}: {
  locale: string;
  fixtureId: string;
  /** Null when the analyst has not written anything about this match yet. */
  workspace: CommunityAnalysisWorkspace | null;
}) {
  const [saveState, saveAction, saving] = useActionState(
    saveAnalysisDraftAction.bind(null, locale, fixtureId),
    null,
  );
  const [submitState, submitAction, submitting] = useActionState(
    submitAnalysisAction.bind(null, locale, fixtureId),
    null,
  );
  const draft = workspace?.draft ?? null;
  const fields = saveState !== null && !saveState.ok ? (saveState.fields ?? {}) : {};

  return (
    <div className="flex flex-col gap-6">
      {workspace !== null && (
        <p className="text-sm text-muted" data-testid="analysis-state">
          {STATE_TEXT[workspace.state]}
        </p>
      )}

      <form action={saveAction} className="flex flex-col gap-3" data-testid="analysis-form">
        <Select
          label="Your call"
          name="predicted_outcome"
          size="sm"
          defaultValue={draft?.predicted_outcome ?? 'home'}
          error={fields.predicted_outcome}
          className="self-start"
        >
          <option value="home">Home win</option>
          <option value="draw">Draw</option>
          <option value="away">Away win</option>
        </Select>

        <div className="flex flex-wrap gap-3">
          <TextField
            label="Home goals (optional)"
            type="number"
            min={0}
            name="predicted_home"
            size="sm"
            controlClassName="w-24"
            defaultValue={draft?.predicted_home ?? ''}
            error={fields.predicted_home}
          />
          <TextField
            label="Away goals (optional)"
            type="number"
            min={0}
            name="predicted_away"
            size="sm"
            controlClassName="w-24"
            defaultValue={draft?.predicted_away ?? ''}
          />
        </div>

        <TextField
          label="Confidence, 1 to 5"
          type="number"
          min={1}
          max={5}
          name="confidence"
          size="sm"
          controlClassName="w-24"
          defaultValue={draft?.confidence ?? 3}
          error={fields.confidence}
        />

        <TextArea
          label="Reasoning"
          name="reasoning"
          rows={6}
          required
          defaultValue={draft?.reasoning ?? ''}
          // The line between an analysis and a prediction, and the product
          // already has predictions.
          hint="An analysis without reasoning is a prediction, and we already have those."
          error={fields.reasoning}
        />

        {(
          [
            ['lineup_impact', 'Lineup impact (optional)'],
            ['key_players', 'Key players (optional)'],
            ['form_and_context', 'Form and context (optional)'],
          ] as const
        ).map(([name, label]) => (
          <TextArea
            key={name}
            label={label}
            name={name}
            rows={3}
            defaultValue={draft?.[name] ?? ''}
          />
        ))}

        <Button
          type="submit"
          pending={saving}
          pendingLabel="Saving…"
          data-testid="analysis-save"
          className="self-start"
        >
          Save draft
        </Button>
        {saveState !== null && (
          <FormStatus ok={saveState.ok} data-testid="analysis-save-result">
            {saveState.message}
          </FormStatus>
        )}
      </form>

      <form action={submitAction} className="flex flex-col gap-2">
        <Button
          type="submit"
          pending={submitting}
          pendingLabel="Sending…"
          disabled={draft === null}
          data-testid="analysis-submit"
          className="self-start"
        >
          Send for review
        </Button>
        {submitState !== null && (
          <FormStatus ok={submitState.ok} data-testid="analysis-submit-result">
            {submitState.message}
          </FormStatus>
        )}
      </form>

      {workspace !== null && workspace.submissions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">What you sent, and what was said</h2>
          <ul className="flex flex-col gap-2">
            {workspace.submissions.map((submission) => (
              <Attempt key={submission.id} submission={submission} />
            ))}
          </ul>
        </section>
      )}

      {workspace !== null && workspace.versions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Published</h2>
          <ul className="flex flex-col gap-2" data-testid="analysis-versions">
            {workspace.versions.map((version) => (
              <li key={version.id} className="rounded border border-default p-3 text-sm">
                <span className="font-medium">Version {version.version_number}</span>
                <time className="ms-2 text-xs text-muted" dateTime={version.published_at}>
                  {version.published_at}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
