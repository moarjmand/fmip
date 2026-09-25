'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { CommunitySubmission } from '@fmip/contracts';
import { reviewAnalysisAction } from '@/lib/analysis-actions';

/**
 * The editorial review queue (blueprint 10.3, T-262).
 *
 * **A reviewer sees the submission, the author, and every decision that came
 * before it.** Deciding from a queue that shows only the text is deciding blind
 * — the same argument the moderation queue makes, and for the same reason: the
 * second time somebody submits the same thing is a different situation from the
 * first.
 *
 * **Every decision carries a reason, including an approval.** The form makes it
 * required and the API refuses without it, which is the copy that counts.
 */

const DECISIONS = [
  ['approved', 'Approve and publish'],
  ['changes_requested', 'Ask for changes'],
  ['rejected', 'Decline'],
] as const;

function Decide({
  locale,
  submission,
  decision,
  label,
}: {
  locale: string;
  submission: string;
  decision: 'approved' | 'changes_requested' | 'rejected';
  label: string;
}) {
  const [state, formAction, pending] = useActionState(
    reviewAnalysisAction.bind(null, locale, submission, decision),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm">
        <span className="sr-only">Why, for {label}</span>
        <textarea
          name="reason"
          rows={2}
          required
          placeholder="Say why. This is recorded."
          className="rounded border border-current/30 bg-transparent p-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        data-testid={`analysis-decide-${decision}-${submission}`}
        className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? 'Recording…' : label}
      </button>
      {state !== null && (
        <p
          role="status"
          className={state.ok ? 'text-sm' : 'text-sm text-red-800 dark:text-red-300'}
          data-testid={`analysis-decide-result-${submission}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function AnalysisQueue({
  locale,
  submissions,
  authors,
  reachable,
}: {
  locale: string;
  submissions: CommunitySubmission[];
  /** Parallel to `submissions`: the author of each, by index. */
  authors: string[];
  /** False when the queue could not be fetched at all. */
  reachable: boolean;
}) {
  if (!reachable) {
    // Stated, not vanished. "The queue could not be fetched" and "nothing is
    // waiting" are different facts, and a reviewer who saw the second when the
    // first was true would go home.
    return (
      <p role="alert" data-testid="analysis-queue-unreachable">
        The review queue cannot be shown right now.
      </p>
    );
  }

  if (submissions.length === 0) {
    return (
      <p className="text-sm opacity-70" data-testid="analysis-queue-empty">
        Nothing is waiting to be read.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-4" data-testid="analysis-queue">
      {submissions.map((submission, index) => (
        <li
          key={submission.id}
          className="flex flex-col gap-3 rounded border border-current/20 p-4"
          data-testid="analysis-queue-item"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm">
              {/* Who wrote it, linked: a reviewer deciding blind is a reviewer
                  guessing, and the author's record is one click away. */}
              <Link
                href={`/${locale}/u/${encodeURIComponent(authors[index] ?? '')}`}
                className="font-medium underline"
                data-testid="analysis-queue-author"
              >
                {authors[index] ?? 'Unknown'}
              </Link>
              {submission.attempt > 1 && (
                // The second attempt is a different situation from the first,
                // and a reviewer should know which one they are reading.
                <span className="ms-2 opacity-70" data-testid="analysis-queue-attempt">
                  attempt {submission.attempt}
                </span>
              )}
            </span>
            <time className="text-xs opacity-60" dateTime={submission.submitted_at}>
              {submission.submitted_at}
            </time>
          </div>

          <p className="text-sm">
            <span className="font-medium">{submission.predicted_outcome}</span>
            {submission.predicted_home !== null && submission.predicted_away !== null && (
              <span className="ms-2">
                {submission.predicted_home}–{submission.predicted_away}
              </span>
            )}
            <span className="ms-2 opacity-70">confidence {submission.confidence}/5</span>
          </p>

          <p className="whitespace-pre-wrap text-sm">{submission.reasoning}</p>
          {(
            [
              ['lineup_impact', 'Lineup impact'],
              ['key_players', 'Key players'],
              ['form_and_context', 'Form and context'],
            ] as const
          ).map(([field, label]) =>
            submission[field] === null ? null : (
              <p key={field} className="text-sm">
                <span className="font-medium">{label}:</span>{' '}
                <span className="whitespace-pre-wrap opacity-80">{submission[field]}</span>
              </p>
            ),
          )}

          <div className="flex flex-wrap gap-4">
            {DECISIONS.map(([decision, label]) => (
              <Decide
                key={decision}
                locale={locale}
                submission={submission.id}
                decision={decision}
                label={label}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
