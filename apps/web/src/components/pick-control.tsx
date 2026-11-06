import {
  DEFAULT_PICK_CONFIDENCE,
  MAX_REASON_TAGS,
  PREDICTION_REASON_TAGS,
  type AuthUser,
  type PendingPick,
  type Prediction,
} from '@fmip/contracts';
import type { ReactNode } from 'react';
import { FilledMessage } from '@/components/filled-message';
import { PickForm } from '@/components/pick-form';
import { ScorePair } from '@/components/score';
import { Translated } from '@/components/translated';
import { Icon, TextArea, buttonClasses, controlClasses } from '@/components/ui';
import Link from '@/components/ui/link';
import { type Locale } from '@/i18n/locales';
import { attribute, interpolate, message, t } from '@/i18n/messages';
import {
  PICK_OUTCOMES,
  type PickOutcome,
  guestPickHref,
  guestSignInHref,
  markedOutcome,
  pendingView,
  pickControlState,
} from '@/lib/pick';
import { savePendingPickAction, submitPredictionAction } from '@/lib/prediction-actions';
import { isLocked } from '@/lib/prediction-form';
import {
  OUTCOME_KEY,
  REASON_TAG_KEY,
  asLocale,
  confidenceText,
  listText,
  plainNumber,
  scoreText,
  utcStamp,
} from '@/lib/prediction-text';
import { formatKickoff } from '@/lib/scores';

/**
 * The pick control (T-1738, D-359; the board's `PickControl`): one component
 * for every place a pick starts -- the matches page's panel and sheet, and,
 * wired by their own tasks, the match page, a team's next-match card and a
 * news story's card. Three equal outcomes in the order home, draw, away, each
 * 44px or taller; saffron (`brand`) fills only the outcome that is chosen,
 * which also carries a tick (a lock once locked) and is exposed as pressed or
 * current, so colour is never the only signal.
 *
 * Its four states (`pickControlState`):
 * - `open`: nothing chosen;
 * - `chosen`: an outcome carried in the address (`chosen`) and not stored --
 *   a guest is told so in one line and offered an account, a member who chose
 *   before signing in is told to tap it;
 * - `saved`: the member's stored pick, changeable until kick-off, with the
 *   optional score, confidence, reasons and note behind "Add detail";
 * - `locked`: after kick-off the three are inert and the stored one is locked.
 *
 * And two for a member whose email address is not confirmed yet (T-1740,
 * D-361), whose tap saves a pending pick instead of a prediction:
 * - `pending`: the pick is saved and marked, and the line says it counts once
 *   they confirm their email address before the kick-off time;
 * - `uncounted`: kick-off came first -- locked, "Saved, not counted", and one
 *   sentence why. A pending pick is the member's alone: it is in no community
 *   figure, and the `split` slot stays closed while one waits.
 *
 * How it works without state of its own: a guest's outcome is a plain link
 * (`guestPickHref`, the contract other pages implement the far side of); a
 * member's is a submit button of a server action -- `submitPredictionAction`
 * (the API's rules and field errors unchanged), or `savePendingPickAction`
 * while the address is not confirmed -- and the saved state is the server's
 * next render of the stored pick. The one client module is `PickForm`, the
 * `<form>` around the server's markup.
 *
 * Rule 6: the pick feeds the community product only. The model's figures
 * arrive in the `model` slot (`ModelBox`), under the control and labelled as
 * the model's -- no percentage and no turquoise is ever drawn in here -- and
 * the community's split in the `split` slot, shown only once the reader has
 * picked or kick-off has locked every pick (D-206).
 */
export function PickControl({
  locale,
  fixture,
  timeZone,
  zone,
  me,
  current,
  pending = null,
  chosen = null,
  split,
  model,
  heading: Heading = 'h3',
}: {
  locale: string;
  fixture: { id: string; kickoff_at: string; home: string; away: string };
  /** The zone the lock time is said in, and that zone in words ("UK time"). */
  timeZone: string;
  zone: string;
  me: AuthUser | null;
  /** The member's stored prediction, or `null`. */
  current: Prediction | null;
  /**
   * The member's pick saved before their email address was confirmed (D-361),
   * as the API has it now, or `null`. Not a prediction; theirs alone.
   */
  pending?: Pick<PendingPick, 'outcome' | 'status'> | null;
  /** The outcome carried in the address (`readPick` of `?pick=`); never stored. */
  chosen?: PickOutcome | null;
  /**
   * The community's split; drawn only in the saved and locked states, never
   * beside a pending pick, waiting or uncounted (rule 6, D-361).
   */
  split?: ReactNode;
  /** The model's box, beside the pick and never mixed with it. */
  model?: ReactNode;
  heading?: 'h2' | 'h3';
}) {
  const l = asLocale(locale);
  const latest = current?.latest ?? null;
  const saved = latest?.outcome ?? null;
  const waiting = pendingView(pending);
  const kickedOff = current?.locked ?? isLocked(fixture.kickoff_at);
  const state = pickControlState({ locked: kickedOff, saved, chosen, pending: waiting });
  // The API's word that a pending pick expired is a kick-off this page's
  // clock may not have reached yet: the control is locked either way.
  const locked = kickedOff || state === 'uncounted';
  const marked = markedOutcome({ locked, saved, chosen, pending: waiting });
  const member = me !== null;
  // A member whose email address is not confirmed yet: their tap saves a
  // pending pick, not a prediction (D-361).
  const unconfirmed = member && !me.email_verified;
  const time = (
    <time dateTime={fixture.kickoff_at}>{formatKickoff(locale, fixture.kickoff_at, timeZone)}</time>
  );
  const group = attribute(l, 'pick.group');
  const groupProps = {
    role: 'group',
    'aria-label': interpolate(group.text, { home: fixture.home, away: fixture.away }),
    lang: group.lang,
    className: 'grid grid-cols-3 gap-2',
  } as const;
  const teamWin = attribute(l, 'predictions.outcome.teamWin');
  /** "Bournemouth win", the accessible name of a team's outcome; "Draw" is its own. */
  const nameProps = (outcome: PickOutcome) =>
    outcome === 'draw'
      ? {}
      : { 'aria-label': interpolate(teamWin.text, { team: fixture[outcome] }), lang: teamWin.lang };
  /** The outcome in a sentence: "Bournemouth win", "Draw". */
  const outcomePhrase = (outcome: PickOutcome): ReactNode =>
    outcome === 'draw' ? (
      <Translated locale={l} message="predictions.outcome.draw" />
    ) : (
      <FilledMessage
        message={message(l, 'predictions.outcome.teamWin')}
        params={{ team: <bdi>{fixture[outcome]}</bdi> }}
      />
    );
  const face = (outcome: PickOutcome): ReactNode => (
    <>
      {/* In the corner, out of the line: beside the name it took the room a long name needs. */}
      {marked === outcome && (
        <span className="absolute end-1 top-1 inline-flex" data-testid="pick-mark">
          <Icon name={locked ? 'lock' : 'check'} size={14} strokeWidth={2.5} />
        </span>
      )}
      {outcome === 'draw' ? (
        <Translated locale={l} message="predictions.outcome.draw" />
      ) : (
        <bdi className="min-w-0 font-stretch-condensed break-words">{fixture[outcome]}</bdi>
      )}
    </>
  );
  /** One outcome under its caption; the caption is drawn, the name is the control's. */
  const column = (outcome: PickOutcome, control: ReactNode): ReactNode => (
    <div key={outcome} className="flex min-w-0 flex-col gap-1" data-option={outcome}>
      <span aria-hidden="true" className="text-center text-xs text-caption">
        <Translated locale={l} message={OUTCOME_KEY[outcome]} />
      </span>
      {control}
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="pick-control" data-pick={state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading className="text-sm font-extrabold">
          <Translated locale={l} message="pick.title" />
        </Heading>
        <p className="inline-flex items-center gap-1 text-xs text-muted" data-testid="pick-lock">
          {locked ? (
            <>
              <Icon name="lock" size={14} />
              <Translated locale={l} message="predictions.section.locked" />
            </>
          ) : (
            <FilledMessage message={message(l, 'pick.locks')} params={{ time, zone }} />
          )}
        </p>
      </div>

      {/* Before a pick is saved, what a tap will do for a member whose email
          address is not confirmed yet; once one is, the line under the
          outcomes says it of that pick. */}
      {unconfirmed && (state === 'open' || state === 'chosen') && (
        <p className="text-sm" role="status" data-testid="pick-confirm">
          <FilledMessage message={message(l, 'pick.pending.confirm')} params={{ time }} />
        </p>
      )}

      {locked ? (
        <div {...groupProps}>
          {PICK_OUTCOMES.map((outcome) =>
            column(
              outcome,
              <button
                type="button"
                disabled
                aria-pressed={marked === outcome}
                {...nameProps(outcome)}
                className={optionClasses(marked === outcome, true)}
              >
                {face(outcome)}
              </button>,
            ),
          )}
        </div>
      ) : member ? (
        <PickForm
          action={(unconfirmed ? savePendingPickAction : submitPredictionAction).bind(
            null,
            locale,
            fixture.id,
          )}
          className="flex flex-col gap-2 aria-busy:pointer-events-none aria-busy:opacity-60"
          testId="pick-form"
        >
          <div {...groupProps}>
            {PICK_OUTCOMES.map((outcome) =>
              column(
                outcome,
                <button
                  type="submit"
                  name="outcome"
                  value={outcome}
                  aria-pressed={marked === outcome}
                  {...nameProps(outcome)}
                  className={optionClasses(marked === outcome, false)}
                >
                  {face(outcome)}
                </button>,
              ),
            )}
          </div>
          {/* What the stored version already says goes with a changed outcome:
              the confidence, the reasons and the note as they are, the score
              only while the outcome it was given for stands (`score_for`). A
              pending pick keeps the outcome alone; the confidence rides along
              for the tap that arrives after the address was confirmed. */}
          <input
            type="hidden"
            name="confidence"
            value={latest?.confidence ?? DEFAULT_PICK_CONFIDENCE}
          />
          {latest !== null && latest.score !== null && (
            <>
              <input type="hidden" name="score_for" value={latest.outcome} />
              <input type="hidden" name="score_home" value={latest.score.home} />
              <input type="hidden" name="score_away" value={latest.score.away} />
            </>
          )}
          {latest?.reason_tags.map((tag) => (
            <input key={tag} type="hidden" name="reason_tags" value={tag} />
          ))}
          {latest !== null && latest.explanation !== null && (
            <input type="hidden" name="explanation" value={latest.explanation} />
          )}
        </PickForm>
      ) : (
        <div {...groupProps}>
          {PICK_OUTCOMES.map((outcome) =>
            column(
              outcome,
              <Link
                href={guestPickHref(locale, fixture.id, outcome)}
                rel="nofollow"
                aria-current={marked === outcome ? 'true' : undefined}
                {...nameProps(outcome)}
                className={optionClasses(marked === outcome, false)}
              >
                {face(outcome)}
              </Link>,
            ),
          )}
        </div>
      )}

      {state === 'saved' && (
        <p className="inline-flex items-center gap-1 text-sm font-bold" data-testid="pick-saved">
          <Icon name="check" size={16} strokeWidth={2} />
          <Translated locale={l} message="pick.saved" />
        </p>
      )}
      {state === 'pending' && (
        <p className="flex items-start gap-1 text-sm font-bold" data-testid="pick-pending">
          <Icon name="check" size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>
            <FilledMessage message={message(l, 'pick.pending.saved')} params={{ time }} />
          </span>
        </p>
      )}
      {state === 'uncounted' && (
        <p
          className="inline-flex items-center gap-1 text-sm font-bold"
          data-testid="pick-uncounted"
        >
          <Icon name="lock" size={16} strokeWidth={2} />
          <Translated locale={l} message="pick.uncounted.title" />
        </p>
      )}

      <p className="text-sm leading-normal text-muted" data-testid="pick-note">
        {state === 'uncounted' && marked !== null ? (
          <FilledMessage
            message={message(l, 'pick.uncounted.note')}
            params={{ outcome: outcomePhrase(marked) }}
          />
        ) : state === 'pending' ? (
          <FilledMessage message={message(l, 'pick.pending.note')} params={{ time }} />
        ) : state === 'locked' || state === 'uncounted' ? (
          marked !== null ? (
            <FilledMessage
              message={message(l, 'pick.note.locked')}
              params={{ outcome: outcomePhrase(marked) }}
            />
          ) : member ? (
            <Translated locale={l} message="predictions.section.none" />
          ) : (
            <Translated locale={l} message="pick.note.lockedNone" />
          )
        ) : state === 'saved' ? (
          <FilledMessage message={message(l, 'pick.note.saved')} params={{ time }} />
        ) : state === 'chosen' && marked !== null ? (
          <FilledMessage
            message={message(l, member ? 'pick.note.carried' : 'pick.note.chosen')}
            params={{ outcome: outcomePhrase(marked), time }}
          />
        ) : member ? (
          <FilledMessage message={message(l, 'pick.note.member')} params={{ time }} />
        ) : (
          <Translated locale={l} message="pick.note.guest" />
        )}
      </p>

      {state === 'chosen' && !member && marked !== null && (
        <div className="flex flex-col gap-2" data-testid="pick-account">
          <Link
            href={guestPickHref(locale, fixture.id, marked)}
            className={buttonClasses({ variant: 'primary', size: 'md', className: 'w-full' })}
            data-testid="pick-create"
          >
            <Translated locale={l} message="pick.create" />
          </Link>
          <Link
            href={guestSignInHref(locale, fixture.id, marked)}
            className={buttonClasses({ size: 'md', className: 'w-full' })}
            data-testid="pick-sign-in"
          >
            <Translated locale={l} message="predictions.section.signIn" />
          </Link>
        </div>
      )}

      {latest !== null && <StoredDetail locale={l} prediction={current} locked={locked} />}

      {state === 'saved' && latest !== null && member && (
        <DetailForm
          locale={l}
          fixture={fixture}
          latest={latest}
          action={submitPredictionAction.bind(null, locale, fixture.id)}
        />
      )}

      {(state === 'saved' || state === 'locked') && split !== undefined && split !== null && (
        <div data-testid="pick-split">{split}</div>
      )}

      {model}
    </div>
  );
}

/**
 * An outcome's box. Unchosen: the outlined secondary. Chosen: the brand fill
 * with ink on it (8.81:1). Locked: inert, the chosen one keeps its fill inside
 * the darker saffron edge (`accent`, 3:1 against the surface for a non-text
 * part), the others go quiet. `disabled` is not dimmed here: the lock and the
 * sentence under the buttons say why they do not answer.
 */
function optionClasses(chosen: boolean, locked: boolean): string {
  const box =
    'relative inline-flex min-h-touch w-full grow items-center justify-center gap-1 rounded-control px-1.5 py-1.5 text-center text-sm leading-tight';
  if (chosen) {
    return `${box} bg-brand font-extrabold text-on-brand ${locked ? 'border-2 border-accent' : 'border border-brand'}`;
  }
  return locked
    ? `${box} border border-default font-bold text-muted`
    : `${box} border border-strong bg-surface font-bold hover:bg-surface-raised`;
}

/**
 * What the stored version says beyond its outcome, and which version it is:
 * the score, the confidence and the reasons on one quiet line when any was
 * given, the note, then "Version 2, submitted … Every version is kept." while
 * the pick is open or "Final version 2 of 3 …" once it is locked. Exported
 * for the match page's locked row (T-1744), which keeps it under its sentence.
 */
export function StoredDetail({
  locale,
  prediction,
  locked,
}: {
  locale: Locale;
  prediction: Prediction | null;
  locked: boolean;
}) {
  if (prediction === null) return null;
  const v = prediction.latest;
  const detailed = v.score !== null || v.reason_tags.length > 0 || v.explanation !== null;
  const stamp = <time dateTime={v.submitted_at}>{utcStamp(locale, v.submitted_at)}</time>;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted" data-testid="pick-stored">
      {detailed && (
        <p>
          {v.score !== null && (
            <>
              <ScorePair locale={locale} testId="prediction-score">
                {scoreText(locale, v.score.home, v.score.away)}
              </ScorePair>
              {' · '}
            </>
          )}
          {confidenceText(locale, v.confidence)}
          {v.reason_tags.length > 0 && (
            <>
              {' · '}
              {listText(
                locale,
                v.reason_tags.map((tag) => t(locale, REASON_TAG_KEY[tag])),
              )}
            </>
          )}
        </p>
      )}
      {v.explanation !== null && <p className="text-fg">{v.explanation}</p>}
      <p data-testid="prediction-versions">
        {locked ? (
          <FilledMessage
            message={{
              ...message(locale, 'predictions.section.final'),
              text: interpolate(t(locale, 'predictions.section.final'), {
                version: plainNumber(locale, v.version_number),
                total: plainNumber(locale, prediction.versions.length),
              }),
            }}
            params={{ time: stamp }}
          />
        ) : (
          <FilledMessage
            message={{
              ...message(locale, 'predictions.form.version'),
              text: interpolate(t(locale, 'predictions.form.version'), {
                version: plainNumber(locale, v.version_number),
              }),
            }}
            params={{ time: stamp }}
          />
        )}
      </p>
    </div>
  );
}

/**
 * "Add detail" (blueprint 6.6's optional exact score, confidence, up to three
 * reasons and a short note), closed until asked for: the board's first step
 * is the outcome alone. A form of its own, so Enter in a field submits this
 * and never an outcome button; it carries the stored outcome and writes a new
 * version through the same action.
 */
function DetailForm({
  locale,
  fixture,
  latest,
  action,
}: {
  locale: Locale;
  fixture: { home: string; away: string };
  latest: Prediction['latest'];
  action: Parameters<typeof PickForm>[0]['action'];
}) {
  const goals = attribute(locale, 'predictions.form.goals');
  return (
    <details className="group text-sm" data-testid="pick-detail">
      <summary className="inline-flex min-h-touch cursor-pointer list-none items-center gap-1 font-bold text-accent hover:underline [&::-webkit-details-marker]:hidden">
        <Translated locale={locale} message="pick.detail" />
        <Icon name="forward" size={16} className="group-open:rotate-90" />
      </summary>
      <PickForm
        action={action}
        className="flex flex-col gap-3 pt-1 aria-busy:pointer-events-none aria-busy:opacity-60"
        testId="pick-detail-form"
      >
        <input type="hidden" name="outcome" value={latest.outcome} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <span className="text-xs text-muted">
              <Translated locale={locale} message="predictions.form.score" />
            </span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                name="score_home"
                min={0}
                max={20}
                className={controlClasses('sm', 'w-14')}
                defaultValue={latest.score?.home ?? ''}
                aria-label={interpolate(goals.text, { team: fixture.home })}
                lang={goals.lang}
              />
              –
              <input
                type="number"
                name="score_away"
                min={0}
                max={20}
                className={controlClasses('sm', 'w-14')}
                defaultValue={latest.score?.away ?? ''}
                aria-label={interpolate(goals.text, { team: fixture.away })}
                lang={goals.lang}
              />
            </span>
          </div>
          <label className="flex flex-col">
            <span className="text-xs text-muted">
              <Translated locale={locale} message="predictions.form.confidence" />
            </span>
            <select
              name="confidence"
              defaultValue={latest.confidence}
              className={controlClasses('sm')}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {plainNumber(locale, n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-xs text-muted">
            <Translated
              locale={locale}
              message="predictions.form.reasons"
              count={MAX_REASON_TAGS}
            />
          </legend>
          {PREDICTION_REASON_TAGS.map((tag) => (
            <label
              key={tag}
              className="flex min-h-touch items-center gap-1 rounded border border-strong px-2 py-1"
            >
              <input
                type="checkbox"
                name="reason_tags"
                value={tag}
                defaultChecked={latest.reason_tags.includes(tag)}
              />
              <Translated locale={locale} message={REASON_TAG_KEY[tag]} />
            </label>
          ))}
        </fieldset>
        <TextArea
          label={<Translated locale={locale} message="predictions.form.why" />}
          name="explanation"
          maxLength={280}
          rows={2}
          size="sm"
          defaultValue={latest.explanation ?? ''}
        />
        <button type="submit" className={buttonClasses({ size: 'md', className: 'self-start' })}>
          <Translated locale={locale} message="predictions.form.update" />
        </button>
      </PickForm>
    </details>
  );
}
