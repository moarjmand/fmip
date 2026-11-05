'use client';

import { PREDICTION_REASON_TAGS, type Prediction, type PredictionReasonTag } from '@fmip/contracts';
import { type ReactNode, useActionState, useState } from 'react';
import type { ActionState } from '@/lib/auth-actions';
import type { Message } from '@/i18n/messages';
import { ShareLink } from './share-link';
import { FormStatus, Icon, TextArea, controlClasses } from '@/components/ui';

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
  /** "Make your pick": the one control before the reader starts (T-1388). */
  makePick: ReactNode;
  /** "Your pick: {home} v {away}", the outcome group's name for a screen reader. */
  group: { text: string; lang?: string };
}

/** The three states of "Make your pick" (T-1388, D-206). */
export type PickState = 'before' | 'choosing' | 'picked';

/** Which state the pick is in: picked once a version is saved, choosing once opened. */
export function pickState(saved: boolean, opened: boolean): PickState {
  return saved ? 'picked' : opened ? 'choosing' : 'before';
}

/**
 * An outcome as a pressable choice in the community lane's colour, never the
 * brand green (the pick feeds the community product only, rule 6). A native
 * radio underneath, so the form, the keyboard and a label lookup work as
 * before; the box shows which is chosen, with a tick as well as the fill.
 */
const OUTCOME_CHOICE =
  'group inline-flex min-h-touch cursor-pointer items-center gap-1.5 rounded-control border border-strong bg-surface px-3.5 font-semibold has-checked:border-community has-checked:bg-community has-checked:text-canvas has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus';

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
  split,
  words,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  current: Prediction | null;
  home: string;
  away: string;
  /** The match's own address, offered for sharing once a prediction is saved (T-521). */
  shareUrl?: string;
  /**
   * The community split, rendered on the server and shown here only once the
   * reader has picked (T-1388): before that it is not on the page at all, so
   * it cannot anchor the pick.
   */
  split?: ReactNode;
  words: PredictionFormWords;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [opened, setOpened] = useState(false);
  const latest = current?.latest ?? null;
  const fieldError = (name: string): string | undefined =>
    state !== null && !state.ok ? state.fields?.[name] : undefined;
  const pick = pickState(latest !== null || state?.ok === true, opened);

  if (pick === 'before') {
    return (
      <div data-testid="prediction-form" data-pick="before">
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="inline-flex min-h-touch items-center gap-2 rounded-control border border-community bg-surface px-4 font-bold text-community"
          data-testid="make-pick"
        >
          <Icon name="pick" />
          {words.makePick}
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 text-sm"
      data-testid="prediction-form"
      data-pick={pick}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{words.call}</legend>
        <div
          role="group"
          aria-label={words.group.text}
          lang={words.group.lang}
          className="flex flex-wrap gap-1.5"
        >
          {(['home', 'draw', 'away'] as const).map((outcome) => (
            <label key={outcome} className={OUTCOME_CHOICE} data-outcome={outcome}>
              <input
                type="radio"
                name="outcome"
                value={outcome}
                defaultChecked={latest?.outcome === outcome}
                required
                className="sr-only"
              />
              <Icon name="check" strokeWidth={2} className="hidden group-has-checked:block" />
              {outcome === 'home' ? (
                <bdi>{home}</bdi>
              ) : outcome === 'away' ? (
                <bdi>{away}</bdi>
              ) : (
                words.draw
              )}
            </label>
          ))}
        </div>
        {fieldError('outcome') && <FormStatus ok={false}>{fieldError('outcome')}</FormStatus>}
        {pick === 'picked' && split !== undefined && <div data-testid="pick-split">{split}</div>}
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
        {/* Locking the pick is the community lane's action, so its colour, not
            the brand green (T-1388); pending as every submit is. */}
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending ? true : undefined}
          className="inline-flex min-h-touch items-center justify-center rounded-control border border-community bg-community px-4 font-semibold text-canvas disabled:opacity-50"
        >
          {latest === null ? words.submit : words.update}
        </button>
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
