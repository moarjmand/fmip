'use client';

import { MAX_REASON_TAGS, PREDICTION_REASON_TAGS, type Prediction } from '@fmip/contracts';
import { useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import { OUTCOME_LABEL, REASON_TAG_LABEL } from '@/lib/prediction-form';
import { ShareLink } from './share-link';
import { Button, FormStatus, TextArea, controlClasses } from '@/components/ui';

/**
 * The member's prediction on the match centre (blueprint 6.6, T-050):
 * outcome, optional exact score, confidence, up to three reason tags, a
 * short explanation. Resubmitting writes a new version; the API keeps them
 * all and this form shows how many there are. Locked after kick-off.
 */
export function PredictionForm({
  action,
  current,
  home,
  away,
  shareUrl,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  current: Prediction | null;
  home: string;
  away: string;
  /** The match's own address, offered for sharing once a prediction is saved (T-521). */
  shareUrl?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const latest = current?.latest ?? null;
  const fieldError = (name: string): string | undefined =>
    state !== null && !state.ok ? state.fields?.[name] : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" data-testid="prediction-form">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 font-medium">Your call</legend>
        {(['home', 'draw', 'away'] as const).map((outcome) => (
          <label key={outcome} className="flex items-center gap-1">
            <input
              type="radio"
              name="outcome"
              value={outcome}
              defaultChecked={latest?.outcome === outcome}
              required
            />
            {outcome === 'home' ? home : outcome === 'away' ? away : OUTCOME_LABEL.draw}
          </label>
        ))}
        {fieldError('outcome') && <FormStatus ok={false}>{fieldError('outcome')}</FormStatus>}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-xs text-muted">Exact score (optional)</span>
          <span className="flex items-center gap-1">
            <input
              type="number"
              name="score_home"
              min={0}
              max={20}
              className={controlClasses('sm', 'w-14')}
              defaultValue={latest?.score?.home ?? ''}
              aria-label={`${home} goals`}
            />
            –
            <input
              type="number"
              name="score_away"
              min={0}
              max={20}
              className={controlClasses('sm', 'w-14')}
              defaultValue={latest?.score?.away ?? ''}
              aria-label={`${away} goals`}
            />
          </span>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted">Confidence</span>
          <select
            name="confidence"
            defaultValue={latest?.confidence ?? 3}
            className={controlClasses('sm')}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fieldError('score') && <FormStatus ok={false}>{fieldError('score')}</FormStatus>}
      {fieldError('confidence') && <FormStatus ok={false}>{fieldError('confidence')}</FormStatus>}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-xs text-muted">Reasons (up to {MAX_REASON_TAGS})</legend>
        {PREDICTION_REASON_TAGS.map((tag) => (
          <label
            key={tag}
            className="flex items-center gap-1 rounded border border-strong px-2 py-1"
          >
            <input
              type="checkbox"
              name="reason_tags"
              value={tag}
              defaultChecked={latest?.reason_tags.includes(tag) ?? false}
            />
            {REASON_TAG_LABEL[tag]}
          </label>
        ))}
        {fieldError('reason_tags') && (
          <FormStatus ok={false}>{fieldError('reason_tags')}</FormStatus>
        )}
      </fieldset>

      <TextArea
        label="Why (optional, 280 characters)"
        name="explanation"
        maxLength={280}
        rows={2}
        size="sm"
        defaultValue={latest?.explanation ?? ''}
        error={fieldError('explanation')}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" pending={pending}>
          {latest === null ? 'Submit prediction' : 'Update prediction'}
        </Button>
        {latest !== null && (
          <span className="text-xs text-muted" data-testid="prediction-versions">
            Version {latest.version_number}, submitted{' '}
            <time dateTime={latest.submitted_at}>
              {latest.submitted_at.slice(0, 16).replace('T', ' ')}
            </time>{' '}
            UTC. Every version is kept.
          </span>
        )}
      </div>
      {state !== null && (
        <FormStatus ok={state.ok} data-testid="prediction-state">
          {state.message}
        </FormStatus>
      )}
      {state !== null && state.ok && shareUrl !== undefined && (
        <p className="text-sm">
          <ShareLink url={shareUrl} title={`${home} v ${away}`} label="Share this match" />
        </p>
      )}
    </form>
  );
}
