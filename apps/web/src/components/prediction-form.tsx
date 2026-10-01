'use client';

import { PREDICTION_REASON_TAGS, type Prediction, type PredictionReasonTag } from '@fmip/contracts';
import { type ReactNode, useActionState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import type { Message } from '@/i18n/messages';
import { ShareLink } from './share-link';
import { Button, FormStatus, TextArea, controlClasses } from '@/components/ui';

/**
 * The form's words, resolved on the server in the reader's language (T-1307):
 * a client component never reads the catalogues (T-1040). Attribute and
 * `<option>` text is a plain string, with `lang` when it is English standing in.
 */
export interface PredictionFormWords {
  call: ReactNode;
  draw: ReactNode;
  score: ReactNode;
  homeGoals: { text: string; lang?: string };
  awayGoals: { text: string; lang?: string };
  confidence: ReactNode;
  /** The labels of confidence 1 to 5, in the reader's digits. */
  confidenceOptions: readonly string[];
  reasons: ReactNode;
  reasonTags: Record<PredictionReasonTag, ReactNode>;
  why: ReactNode;
  submit: ReactNode;
  update: ReactNode;
  /** "Version 2, submitted … UTC. Every version is kept.", or null before the first. */
  version: ReactNode;
  share: ReactNode;
  shareTitle: string;
  /** "Link copied." and "Copy this link: {url}", for the share control. */
  shareMessages: { copied: Message; manual: Message };
}

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
  words,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  current: Prediction | null;
  home: string;
  away: string;
  /** The match's own address, offered for sharing once a prediction is saved (T-521). */
  shareUrl?: string;
  words: PredictionFormWords;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const latest = current?.latest ?? null;
  const fieldError = (name: string): string | undefined =>
    state !== null && !state.ok ? state.fields?.[name] : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3 text-sm" data-testid="prediction-form">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="mb-1 font-medium">{words.call}</legend>
        {(['home', 'draw', 'away'] as const).map((outcome) => (
          <label key={outcome} className="flex items-center gap-1">
            <input
              type="radio"
              name="outcome"
              value={outcome}
              defaultChecked={latest?.outcome === outcome}
              required
            />
            {outcome === 'home' ? home : outcome === 'away' ? away : words.draw}
          </label>
        ))}
        {fieldError('outcome') && <FormStatus ok={false}>{fieldError('outcome')}</FormStatus>}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-xs text-muted">{words.score}</span>
          <span className="flex items-center gap-1">
            <input
              type="number"
              name="score_home"
              min={0}
              max={20}
              className={controlClasses('sm', 'w-14')}
              defaultValue={latest?.score?.home ?? ''}
              aria-label={words.homeGoals.text}
              lang={words.homeGoals.lang}
            />
            –
            <input
              type="number"
              name="score_away"
              min={0}
              max={20}
              className={controlClasses('sm', 'w-14')}
              defaultValue={latest?.score?.away ?? ''}
              aria-label={words.awayGoals.text}
              lang={words.awayGoals.lang}
            />
          </span>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted">{words.confidence}</span>
          <select
            name="confidence"
            defaultValue={latest?.confidence ?? 3}
            className={controlClasses('sm')}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {words.confidenceOptions[n - 1] ?? n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fieldError('score') && <FormStatus ok={false}>{fieldError('score')}</FormStatus>}
      {fieldError('confidence') && <FormStatus ok={false}>{fieldError('confidence')}</FormStatus>}

      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1 text-xs text-muted">{words.reasons}</legend>
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
            {words.reasonTags[tag]}
          </label>
        ))}
        {fieldError('reason_tags') && (
          <FormStatus ok={false}>{fieldError('reason_tags')}</FormStatus>
        )}
      </fieldset>

      <TextArea
        label={words.why}
        name="explanation"
        maxLength={280}
        rows={2}
        size="sm"
        defaultValue={latest?.explanation ?? ''}
        error={fieldError('explanation')}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" pending={pending}>
          {latest === null ? words.submit : words.update}
        </Button>
        {latest !== null && (
          <span className="text-xs text-muted" data-testid="prediction-versions">
            {words.version}
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
          <ShareLink
            url={shareUrl}
            title={words.shareTitle}
            label={words.share}
            messages={words.shareMessages}
          />
        </p>
      )}
    </form>
  );
}
