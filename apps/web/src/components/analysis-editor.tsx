'use client';

import { useActionState } from 'react';
import type { CommunityAnalysisWorkspace, CommunitySubmission } from '@fmip/contracts';
import { saveAnalysisDraftAction, submitAnalysisAction } from '@/lib/analysis-actions';

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
      className="flex flex-col gap-1 rounded border border-current/20 p-3"
      data-testid="analysis-attempt"
    >
      <span className="text-sm font-medium">Attempt {submission.attempt}</span>
      <time className="text-xs opacity-60" dateTime={submission.submitted_at}>
        {submission.submitted_at}
      </time>
      {submission.review === null ? (
        // Said, not left blank. "Waiting" and "declined without a note" are
        // different things and an analyst should not have to guess which.
        <span className="text-sm opacity-70" data-testid="analysis-attempt-waiting">
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
          <span className="whitespace-pre-wrap opacity-80">{submission.review.reason}</span>
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
        <p className="text-sm opacity-70" data-testid="analysis-state">
          {STATE_TEXT[workspace.state]}
        </p>
      )}

      <form action={saveAction} className="flex flex-col gap-3" data-testid="analysis-form">
        <label className="flex flex-col gap-1 text-sm">
          <span>Your call</span>
          <select
            name="predicted_outcome"
            defaultValue={draft?.predicted_outcome ?? 'home'}
            className="rounded border border-current/30 bg-transparent p-1"
          >
            <option value="home">Home win</option>
            <option value="draw">Draw</option>
            <option value="away">Away win</option>
          </select>
          {fields.predicted_outcome !== undefined && (
            <span className="text-xs text-red-800 dark:text-red-300">
              {fields.predicted_outcome}
            </span>
          )}
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>Home goals (optional)</span>
            <input
              type="number"
              min={0}
              name="predicted_home"
              defaultValue={draft?.predicted_home ?? ''}
              className="w-24 rounded border border-current/30 bg-transparent p-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>Away goals (optional)</span>
            <input
              type="number"
              min={0}
              name="predicted_away"
              defaultValue={draft?.predicted_away ?? ''}
              className="w-24 rounded border border-current/30 bg-transparent p-1"
            />
          </label>
        </div>
        {fields.predicted_home !== undefined && (
          <span className="text-xs text-red-800 dark:text-red-300">{fields.predicted_home}</span>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span>Confidence, 1 to 5</span>
          <input
            type="number"
            min={1}
            max={5}
            name="confidence"
            defaultValue={draft?.confidence ?? 3}
            className="w-24 rounded border border-current/30 bg-transparent p-1"
          />
          {fields.confidence !== undefined && (
            <span className="text-xs text-red-800 dark:text-red-300">{fields.confidence}</span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>Reasoning</span>
          <textarea
            name="reasoning"
            rows={6}
            required
            defaultValue={draft?.reasoning ?? ''}
            className="rounded border border-current/30 bg-transparent p-2"
          />
          {/* The line between an analysis and a prediction, and the product
              already has predictions. */}
          <span className="text-xs opacity-60">
            An analysis without reasoning is a prediction, and we already have those.
          </span>
          {fields.reasoning !== undefined && (
            <span className="text-xs text-red-800 dark:text-red-300">{fields.reasoning}</span>
          )}
        </label>

        {(
          [
            ['lineup_impact', 'Lineup impact (optional)'],
            ['key_players', 'Key players (optional)'],
            ['form_and_context', 'Form and context (optional)'],
          ] as const
        ).map(([name, label]) => (
          <label key={name} className="flex flex-col gap-1 text-sm">
            <span>{label}</span>
            <textarea
              name={name}
              rows={3}
              defaultValue={draft?.[name] ?? ''}
              className="rounded border border-current/30 bg-transparent p-2"
            />
          </label>
        ))}

        <button
          type="submit"
          disabled={saving}
          data-testid="analysis-save"
          className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        {saveState !== null && (
          <p
            role="status"
            data-testid="analysis-save-result"
            className={saveState.ok ? 'text-sm' : 'text-sm text-red-800 dark:text-red-300'}
          >
            {saveState.message}
          </p>
        )}
      </form>

      <form action={submitAction} className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={submitting || draft === null}
          data-testid="analysis-submit"
          className="self-start rounded border border-current px-3 py-1 text-sm disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send for review'}
        </button>
        {submitState !== null && (
          <p
            role="status"
            data-testid="analysis-submit-result"
            className={submitState.ok ? 'text-sm' : 'text-sm text-red-800 dark:text-red-300'}
          >
            {submitState.message}
          </p>
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
              <li key={version.id} className="rounded border border-current/20 p-3 text-sm">
                <span className="font-medium">Version {version.version_number}</span>
                <time className="ms-2 text-xs opacity-60" dateTime={version.published_at}>
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
