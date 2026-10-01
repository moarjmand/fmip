import type { GroupSummary } from '@fmip/contracts';
import { openThreadAction } from '@/lib/thread-actions';
import { CommunityAction } from '@/components/community-action';
import { Said } from '@/components/community-text';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

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
  // A success is a redirect into the thread, so only a refusal is ever said here.
  return (
    <CommunityAction
      action={openThreadAction.bind(null, locale, group.slug, fixtureId)}
      submit={<Said locale={locale} message="threads.discussIn" params={{ group: group.name }} />}
      working={<Translated locale={locale} message="threads.working" />}
      testId={`open-thread-${group.slug}`}
    />
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
      <h2 className="text-lg font-semibold">
        <Translated locale={locale} message="threads.title" />
      </h2>
      {!reachable ? (
        // Stated, not vanished: "your groups could not be fetched" and "you are
        // in none" are different facts and a reader must be able to tell them
        // apart (rule 3).
        <Notice tone="danger" data-testid="match-threads-unreachable">
          <Translated locale={locale} message="groupsPage.yoursUnreachable" />
        </Notice>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted" data-testid="match-threads-none">
          <Translated locale={locale} message="threads.none" />
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
