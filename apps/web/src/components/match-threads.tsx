'use client';

import { useActionState } from 'react';
import type { GroupSummary } from '@fmip/contracts';
import { openThreadAction } from '@/lib/thread-actions';

/**
 * Opening a match thread from the match (blueprint 8.2, T-248).
 *
 * **"A thread is opened from the match it is about"** — so the control lives
 * here rather than on the group page, where a member would have had to describe
 * which match they meant.
 *
 * One button per group, and the same button whether or not the thread already
 * exists: opening is idempotent (T-244), so there is nothing to ask first and
 * nothing to get wrong between asking and pressing. A member in six groups
 * would otherwise have cost six requests to render one line.
 */
function OpenThread({
  locale,
  group,
  fixtureId,
}: {
  locale: string;
  group: GroupSummary;
  fixtureId: string;
}) {
  const [state, formAction, pending] = useActionState(
    openThreadAction.bind(null, locale, group.slug, fixtureId),
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button
        type="submit"
        disabled={pending}
        data-testid={`open-thread-${group.slug}`}
        className="self-start rounded border border-current/30 px-3 py-1 text-sm disabled:opacity-50"
      >
        {pending ? 'Working…' : `Discuss in ${group.name}`}
      </button>
      {state !== null && !state.ok && (
        <p
          role="status"
          className="text-sm text-red-800"
          data-testid={`open-thread-${group.slug}-result`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export function MatchThreads({
  locale,
  groups,
  fixtureId,
  reachable,
}: {
  locale: string;
  groups: GroupSummary[];
  fixtureId: string;
  /** False when the groups could not be fetched at all. */
  reachable: boolean;
}) {
  return (
    <section className="flex flex-col gap-3" data-testid="match-threads">
      <h2 className="text-lg font-semibold">Talk about this match</h2>
      {!reachable ? (
        // Stated, not vanished: "your groups could not be fetched" and "you are
        // in none" are different facts and a reader must be able to tell them
        // apart (rule 3).
        <p role="alert" data-testid="match-threads-unreachable">
          Your groups cannot be shown right now.
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm opacity-70" data-testid="match-threads-none">
          A match thread happens inside a group. You are not in one yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <OpenThread key={group.slug} locale={locale} group={group} fixtureId={fixtureId} />
          ))}
        </div>
      )}
    </section>
  );
}
