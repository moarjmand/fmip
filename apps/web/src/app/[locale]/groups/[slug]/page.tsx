import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  GroupControls,
  GroupRulesForm,
  JoinRequestControls,
  RulesSeen,
} from '@/components/group-controls';
import { GroupPollsSection } from '@/components/group-polls';
import { MemberHandle, MemberName } from '@/components/member-name';
import {
  fetchGroupClosureAppeal,
  fetchGroup,
  fetchGroupLeaderboard,
  fetchGroupPolls,
  fetchGroupRequests,
  fetchMe,
} from '@/lib/api';
import { favouriteDirectoryHref, favouriteHref, languageName } from '@/lib/group-about';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';
import { AppealNotes, GroupAppealForm } from '@/components/group-moderation';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({ locale, path: '/groups', title: 'A group · FMIP' });
}

const VISIBILITY: Record<string, string> = {
  public: 'Anyone can find this group and join it.',
  discoverable: 'Anyone can find this group. Joining it is by request.',
  invite_only: 'This group is joined by invitation.',
};

/**
 * One group (blueprint 8.2, T-242).
 *
 * **A private group is not discoverable and an invite-only one is not
 * joinable** — the acceptance criterion, and neither half is enforced here. An
 * invite-only group the viewer has no invitation to answers 404 from the API, so
 * this page never learns it exists; a discoverable one answers with
 * `members: null`, so there is nothing to render and no filter to forget.
 *
 * What the page decides is only what to say about what it was given: the
 * membership when there is one, the queue when the viewer runs the group, and a
 * control that follows `standing` exactly.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const cookie = await sessionCookieHeader();
  const me = await fetchMe(cookie);
  if (me === null) redirect(`/${locale}/login`);

  const result = await fetchGroup(slug, cookie);
  if (!result.ok) {
    // 404 covers "no such group" and "you may not know it is there", which is
    // the API's answer and not something this page second-guesses.
    if (result.status === 404) notFound();
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold">A group</h1>
        <Notice tone="danger" data-testid="group-unreachable">
          This group cannot be shown right now.
        </Notice>
      </main>
    );
  }

  const group = result.data.group;
  // The group's own words carry its language (T-1022); the page's stay the site's.
  const lang = group.language ?? undefined;
  const decides = group.standing === 'owner' || group.standing === 'moderator';
  // `members === null` is the API's own answer to "may this viewer see who is
  // in this group", and the board is that list with numbers beside it — so it
  // is the same question, asked once, rather than a 403 fetched on purpose.
  const board = group.members === null ? null : await fetchGroupLeaderboard(slug, cookie);
  const queue = decides ? await fetchGroupRequests(slug, cookie) : null;
  // Polls are for the people in the group (T-643, D-091), so only they ask.
  const inside = decides || group.standing === 'member';
  const polls = inside ? await fetchGroupPolls(slug, cookie) : null;
  // A closed group (T-1025): the owner's appeal, asked only by the owner.
  const appeal =
    group.closed !== null && group.standing === 'owner'
      ? await fetchGroupClosureAppeal(slug, cookie)
      : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <Link href={`/${locale}/groups`} className="text-sm underline">
        All groups
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="group-name" lang={lang}>
          {group.name}
        </h1>
        <p className="text-sm text-muted" data-testid="group-visibility">
          <Translated locale={locale} message="groups.memberCount" count={group.member_count} /> ·{' '}
          {VISIBILITY[group.visibility] ?? group.visibility}
        </p>
        {group.description !== null && (
          <p data-testid="group-description" lang={lang}>
            {group.description}
          </p>
        )}
        {/* A group with neither says nothing, rather than "none" (T-1022). */}
        {group.language !== null && (
          <p className="text-sm text-muted" data-testid="group-language">
            <Translated locale={locale} message="groups.about.language" />{' '}
            {languageName(locale, group.language)}
          </p>
        )}
        {group.favourite !== null && (
          <p className="text-sm" data-testid="group-favourite">
            <Translated locale={locale} message="groups.about.favourite" />{' '}
            <Link href={favouriteHref(locale, group.favourite)} className="underline">
              {group.favourite.name}
            </Link>{' '}
            ·{' '}
            <Link
              href={favouriteDirectoryHref(locale, group.favourite)}
              className="text-muted underline"
            >
              <Translated locale={locale} message="groups.about.moreGroups" />
            </Link>
          </p>
        )}
      </header>

      {group.closed !== null && (
        <Notice tone="warning" as="div" className="flex flex-col gap-2" data-testid="group-closed">
          <p>
            The platform&rsquo;s moderators closed this group:{' '}
            <span data-testid="group-closed-reason">{group.closed.reason}</span>
          </p>
          <p>Its members can read it and leave it. Nothing new can be written in it.</p>
        </Notice>
      )}

      {appeal !== null && (
        <section className="flex flex-col gap-2" data-testid="group-appeal">
          <h2 className="text-lg font-semibold">Appeal</h2>
          {appeal.ok ? (
            <AppealNotes notes={appeal.data.notes} />
          ) : (
            <Notice tone="danger">The appeal cannot be shown right now.</Notice>
          )}
          <GroupAppealForm locale={locale} slug={group.slug} />
        </section>
      )}

      {group.rules_changed && group.rules !== null && (
        <Notice
          tone="info"
          as="div"
          className="flex flex-col gap-2"
          data-testid="group-rules-changed"
        >
          <p>
            This group&rsquo;s rules have changed (version {group.rules.version}). Read them below.
            You stay a member either way.
          </p>
          <RulesSeen locale={locale} slug={group.slug} />
        </Notice>
      )}

      {group.rules !== null && (
        <section className="flex flex-col gap-2" data-testid="group-rules">
          <h2 className="text-lg font-semibold">This group&rsquo;s rules</h2>
          <p
            className="whitespace-pre-line text-sm"
            lang={lang}
            data-testid="group-rules-body-text"
          >
            {group.rules.body}
          </p>
          <p className="text-sm text-muted" data-testid="group-rules-whose">
            Version {group.rules.version}. Written by the group&rsquo;s owner: these are the
            group&rsquo;s own rules, not the platform&rsquo;s, and they sit beside the platform
            rules every member already accepted.
          </p>
        </section>
      )}

      {group.closed === null || group.standing === 'member' || group.standing === 'moderator' ? (
        // Closed: the way out stays (leaving), every way in goes.
        <GroupControls
          locale={locale}
          slug={group.slug}
          standing={group.standing}
          rulesVersion={group.rules?.version ?? null}
        />
      ) : null}

      {group.standing === 'owner' && group.closed === null && (
        <section className="flex flex-col gap-2" data-testid="group-rules-owner">
          <h2 className="text-lg font-semibold">Rules</h2>
          <GroupRulesForm locale={locale} slug={group.slug} current={group.rules?.body ?? null} />
        </section>
      )}

      {group.conversation_id !== null && (
        <Link
          href={`/${locale}/messages/${group.conversation_id}`}
          className="underline"
          data-testid="group-conversation"
        >
          Open the group conversation
        </Link>
      )}

      <section className="flex flex-col gap-2" data-testid="group-members">
        <h2 className="text-lg font-semibold">Members</h2>
        {group.members === null ? (
          // Found, not read. Saying so is the point of the middle visibility;
          // an empty list would have said "nobody", which of a group is never
          // true.
          <p className="text-sm text-muted" data-testid="group-members-hidden">
            Who is in this group is shown to its members.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {group.members.map((member) => (
              <li key={member.username} className="text-sm">
                <MemberName locale={locale} member={member} link className="underline" />{' '}
                <span className="text-muted">
                  <MemberHandle username={member.username} />
                  {member.role === 'member' ? '' : ` · ${member.role}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {polls !== null && (
        <section className="flex flex-col gap-3" data-testid="group-polls">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupPolls.title" />
          </h2>
          <GroupPollsSection
            locale={locale}
            slug={group.slug}
            timeZone={me.timezone}
            result={polls}
          />
        </section>
      )}

      {board !== null && (
        <section className="flex flex-col gap-3" data-testid="group-board">
          <h2 className="text-lg font-semibold">The board</h2>
          {!board.ok ? (
            <Notice tone="danger" data-testid="group-board-unreachable">
              The board cannot be shown right now.
            </Notice>
          ) : board.data.entries.length === 0 ? (
            // The floor does not bend for a small group (D-037), so a group can
            // have no board at all — and saying which filter produced that is
            // the difference between an honest absence and a page that looks
            // like nobody is here.
            <p className="text-sm text-muted" data-testid="group-board-none">
              Nobody in this group has settled {board.data.min_settled} predictions yet, so there is
              nobody to rank. That is the same filter the whole product uses.
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {board.data.entries.map((entry) => (
                  <li key={entry.username} className="flex items-baseline gap-3 text-sm">
                    <span className="w-6 text-end text-muted">{entry.rank}</span>
                    <MemberName locale={locale} member={entry} link className="underline" />
                    <span className="ms-auto tabular-nums">{ratingLabel(entry)}</span>
                    <span className="text-muted">{tierLabel(entry.tier)}</span>
                    <span className="text-muted">{statusLabel(entry)}</span>
                  </li>
                ))}
              </ol>
              {board.data.total > board.data.entries.length && (
                <p className="text-sm text-muted" data-testid="group-board-more">
                  Showing {board.data.entries.length} of {board.data.total} ranked members.
                </p>
              )}
            </>
          )}
          <p className="text-sm text-muted" data-testid="group-board-note">
            Ranked among this group&rsquo;s members by the same rating as the{' '}
            <Link href={`/${locale}/leaderboard`} className="underline">
              global board
            </Link>
            . The rating is the one number; only who it is measured against changes.
          </p>
        </section>
      )}

      {decides && (
        <section className="flex flex-col gap-3" data-testid="group-queue">
          <h2 className="text-lg font-semibold">Asking to join</h2>
          {queue === null || !queue.ok ? (
            <Notice tone="danger" data-testid="group-queue-unreachable">
              The queue cannot be shown right now.
            </Notice>
          ) : queue.data.requests.length === 0 ? (
            <p className="text-sm text-muted" data-testid="group-queue-none">
              Nobody is waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {queue.data.requests.map((request) => (
                <li key={request.username} className="flex flex-col gap-2">
                  <p className="text-sm">
                    <MemberName locale={locale} member={request} link className="underline" />{' '}
                    <MemberHandle username={request.username} className="text-muted" />
                  </p>
                  {request.note !== null && <p className="text-sm">{request.note}</p>}
                  <JoinRequestControls
                    locale={locale}
                    slug={group.slug}
                    username={request.username}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-sm text-muted">
        Blocking and reporting live on a member’s profile, where they work the same way everywhere
        else in the product.
      </p>
    </main>
  );
}
