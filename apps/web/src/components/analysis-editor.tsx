'use client';

import { type ReactNode, useActionState } from 'react';
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
 *
 * **Its words come from the server (T-1307).** A client component never reads
 * the catalogues (T-1040), so the page resolves every sentence here in the
 * reader's language -- including each attempt's and version's heading and
 * time -- and hands them in as `words`.
 */

export interface AnalysisEditorWords {
  /** Where the analysis has got to, one sentence per workspace state. */
  states: Record<CommunityAnalysisWorkspace['state'], ReactNode>;
  /** Per submission id: "Attempt 2", its time, and "Declined by …" once decided. */
  attempts: Record<string, { title: ReactNode; at: string; decided: ReactNode }>;
  /** Per version id: "Version 2" and its time. */
  versions: Record<string, { title: ReactNode; at: string }>;
  waiting: ReactNode;
  call: ReactNode;
  /** `<option>` text is a plain string. */
  outcomes: { home: string; draw: string; away: string };
  homeGoals: ReactNode;
  awayGoals: ReactNode;
  confidence: ReactNode;
  reasoning: ReactNode;
  reasoningHint: ReactNode;
  lineup: ReactNode;
  keyPlayers: ReactNode;
  form: ReactNode;
  saving: ReactNode;
  save: ReactNode;
  sending: ReactNode;
  submit: ReactNode;
  history: ReactNode;
  published: ReactNode;
  /** Said on success in the reader's language; a refusal is the API's own sentence. */
  saved: ReactNode;
  sent: ReactNode;
}

function Attempt({
  submission,
  words,
}: {
  submission: CommunitySubmission;
  words: AnalysisEditorWords;
}) {
  const said = words.attempts[submission.id];
  return (
    <li
      className="flex flex-col gap-1 rounded border border-default p-3"
      data-testid="analysis-attempt"
    >
      <span className="text-sm font-medium">{said?.title ?? submission.attempt}</span>
      <time className="text-xs text-muted" dateTime={submission.submitted_at}>
        {said?.at ?? submission.submitted_at}
      </time>
      {submission.review === null ? (
        // Said, not left blank. "Waiting" and "declined without a note" are
        // different things and an analyst should not have to guess which.
        <span className="text-sm text-muted" data-testid="analysis-attempt-waiting">
          {words.waiting}
        </span>
      ) : (
        <span className="flex flex-col gap-1 text-sm" data-testid="analysis-attempt-decided">
          <span className="font-medium">{said?.decided ?? submission.review.decision}</span>
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
  words,
}: {
  locale: string;
  fixtureId: string;
  /** Null when the analyst has not written anything about this match yet. */
  workspace: CommunityAnalysisWorkspace | null;
  words: AnalysisEditorWords;
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
          {words.states[workspace.state]}
        </p>
      )}

      <form action={saveAction} className="flex flex-col gap-3" data-testid="analysis-form">
        <Select
          label={words.call}
          name="predicted_outcome"
          size="sm"
          defaultValue={draft?.predicted_outcome ?? 'home'}
          error={fields.predicted_outcome}
          className="self-start"
        >
          <option value="home">{words.outcomes.home}</option>
          <option value="draw">{words.outcomes.draw}</option>
          <option value="away">{words.outcomes.away}</option>
        </Select>

        <div className="flex flex-wrap gap-3">
          <TextField
            label={words.homeGoals}
            type="number"
            min={0}
            name="predicted_home"
            size="sm"
            controlClassName="w-24"
            defaultValue={draft?.predicted_home ?? ''}
            error={fields.predicted_home}
          />
          <TextField
            label={words.awayGoals}
            type="number"
            min={0}
            name="predicted_away"
            size="sm"
            controlClassName="w-24"
            defaultValue={draft?.predicted_away ?? ''}
          />
        </div>

        <TextField
          label={words.confidence}
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
          label={words.reasoning}
          name="reasoning"
          rows={6}
          required
          defaultValue={draft?.reasoning ?? ''}
          // The line between an analysis and a prediction, and the product
          // already has predictions.
          hint={words.reasoningHint}
          error={fields.reasoning}
        />

        {(
          [
            ['lineup_impact', words.lineup],
            ['key_players', words.keyPlayers],
            ['form_and_context', words.form],
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
          pendingLabel={words.saving}
          data-testid="analysis-save"
          className="self-start"
        >
          {words.save}
        </Button>
        {saveState !== null && (
          <FormStatus ok={saveState.ok} data-testid="analysis-save-result">
            {saveState.ok ? words.saved : saveState.message}
          </FormStatus>
        )}
      </form>

      <form action={submitAction} className="flex flex-col gap-2">
        <Button
          type="submit"
          pending={submitting}
          pendingLabel={words.sending}
          disabled={draft === null}
          data-testid="analysis-submit"
          className="self-start"
        >
          {words.submit}
        </Button>
        {submitState !== null && (
          <FormStatus ok={submitState.ok} data-testid="analysis-submit-result">
            {submitState.ok ? words.sent : submitState.message}
          </FormStatus>
        )}
      </form>

      {workspace !== null && workspace.submissions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{words.history}</h2>
          <ul className="flex flex-col gap-2">
            {workspace.submissions.map((submission) => (
              <Attempt key={submission.id} submission={submission} words={words} />
            ))}
          </ul>
        </section>
      )}

      {workspace !== null && workspace.versions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{words.published}</h2>
          <ul className="flex flex-col gap-2" data-testid="analysis-versions">
            {workspace.versions.map((version) => (
              <li key={version.id} className="rounded border border-default p-3 text-sm">
                <span className="font-medium">
                  {words.versions[version.id]?.title ?? version.version_number}
                </span>
                <time className="ms-2 text-xs text-muted" dateTime={version.published_at}>
                  {words.versions[version.id]?.at ?? version.published_at}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
