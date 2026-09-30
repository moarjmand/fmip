import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  GroupAppealForm,
  GroupControls,
  GroupRulesForm,
  JoinRequestControls,
  RulesSeen,
} from '@/components/group-controls';
import { GroupPollsSection } from '@/components/group-polls';
import { GroupInviteLinks, GroupOwnerSettings } from '@/components/group-settings';
import { MemberHandle, MemberName } from '@/components/member-name';
import { formatDateTime } from '@/i18n/format';
import {
  fetchCompetitions,
  fetchGroupClosureAppeal,
  fetchGroup,
  fetchGroupInviteLinks,
  fetchGroupLeaderboard,
  fetchGroupPolls,
  fetchGroupRequests,
  fetchMe,
  fetchTeams,
} from '@/lib/api';
import { favouriteDirectoryHref, favouriteHref, languageName } from '@/lib/group-about';
import { ratingLabel, statusLabel, tierLabel } from '@/lib/leaderboard';
import { pageMetadata } from '@/lib/seo';
import { sessionCookieHeader } from '@/lib/session';
import { Translated } from '@/components/translated';
import { AppealNotes } from '@/components/group-moderation';
import { Notice } from '@/components/ui';
import { Said, said } from '@/components/community-text';
import { MessageText } from '@/components/message-text';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, type Locale, isLocale } from '@/i18n/locales';
import { type MessageKey, t } from '@/i18n/messages';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return pageMetadata({
    locale,
    path: '/groups',
    title: `${t(resolved, 'groupsPage.group')} · FMIP`,
  });
}

const VISIBILITY: Record<string, MessageKey> = {
  public: 'groupsPage.visibility.public',
  discoverable: 'groupsPage.visibility.discoverable',
  invite_only: 'groupsPage.control.inviteOnly',
};

/** A member's role beside their name; `member` says nothing. */
const ROLE: Record<string, MessageKey> = {
  owner: 'groupsPage.role.owner',
  moderator: 'groupsPage.role.moderator',
};

/**
 * A sentence with a link inside it: the catalogue holds the whole sentence
 * with `{link}` where the link goes, so each language puts it where its own
 * word order does (T-1308).
 */
function WithLink({
  locale,
  message,
  link,
}: {
  locale: string;
  message: MessageKey;
  link: React.ReactNode;
}) {
  const whole = said(locale, message);
  const [before = '', after = ''] = whole.text.split('{link}');
  return (
    <>
      <MessageText message={{ ...whole, text: before }} />
      {link}
      <MessageText message={{ ...whole, text: after }} />
    </>
  );
}

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
        <h1 className="text-2xl font-semibold">
          <Translated locale={locale} message="groupsPage.group" />
        </h1>
        <Notice tone="danger" data-testid="group-unreachable">
          <Translated locale={locale} message="groupsPage.unreachable" />
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
  // Running the group (T-1026). A closed group changes nothing (T-1025), so
  // none of these is asked of one. The owner's settings need the clubs and
  // competitions to choose a favourite from; the links are for whoever the
  // invite policy lets invite, and for the owner and moderators who manage them.
  const running = group.closed === null;
  const owns = running && group.standing === 'owner';
  const [teams, competitions] = owns
    ? await Promise.all([fetchTeams(), fetchCompetitions()])
    : [null, null];
  const links =
    running && inside && (group.may_invite || decides)
      ? await fetchGroupInviteLinks(slug, cookie)
      : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <Link href={`/${locale}/groups`} className="text-sm underline">
        <Translated locale={locale} message="groupsPage.all" />
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold" data-testid="group-name" lang={lang}>
          {group.name}
        </h1>
        <p className="text-sm text-muted" data-testid="group-visibility">
          <Translated locale={locale} message="groups.memberCount" count={group.member_count} /> ·{' '}
          {VISIBILITY[group.visibility] === undefined ? (
            group.visibility
          ) : (
            <Translated locale={locale} message={VISIBILITY[group.visibility]!} />
          )}
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
            <Translated locale={locale} message="groupsPage.closed" />{' '}
            <span data-testid="group-closed-reason">{group.closed.reason}</span>
          </p>
          <p>
            <Translated locale={locale} message="groupsPage.closedNote" />
          </p>
        </Notice>
      )}

      {appeal !== null && (
        <section className="flex flex-col gap-2" data-testid="group-appeal">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupsPage.appeal.title" />
          </h2>
          {appeal.ok ? (
            <AppealNotes
              notes={appeal.data.notes}
              empty={<Translated locale={locale} message="groupsPage.appeal.none" />}
              times={Object.fromEntries(
                appeal.data.notes.map((note) => [
                  note.id,
                  formatDateTime(locale, note.created_at, me.timezone),
                ]),
              )}
            />
          ) : (
            <Notice tone="danger">
              <Translated locale={locale} message="groupsPage.appeal.unreachable" />
            </Notice>
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
            <Said
              locale={locale}
              message="groupsPage.rulesChanged"
              params={{ version: formatNumber(locale, group.rules.version) }}
            />
          </p>
          <RulesSeen locale={locale} slug={group.slug} />
        </Notice>
      )}

      {group.rules !== null && (
        <section className="flex flex-col gap-2" data-testid="group-rules">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupsPage.rulesTitle" />
          </h2>
          <p
            className="whitespace-pre-line text-sm"
            lang={lang}
            data-testid="group-rules-body-text"
          >
            {group.rules.body}
          </p>
          <p className="text-sm text-muted" data-testid="group-rules-whose">
            <Said
              locale={locale}
              message="groupsPage.rulesWhose"
              params={{ version: formatNumber(locale, group.rules.version) }}
            />
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
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupsPage.rulesOwner" />
          </h2>
          <GroupRulesForm locale={locale} slug={group.slug} current={group.rules?.body ?? null} />
        </section>
      )}

      {owns && (
        <GroupOwnerSettings
          locale={locale}
          group={group}
          teams={teams}
          competitions={competitions}
        />
      )}

      {links !== null && (
        <GroupInviteLinks locale={locale} slug={group.slug} timeZone={me.timezone} result={links} />
      )}

      {decides && (
        <Link
          href={`/${locale}/groups/${encodeURIComponent(group.slug)}/history`}
          className="self-start underline"
          data-testid="group-history-link"
        >
          <Translated locale={locale} message="groupSettings.history.link" />
        </Link>
      )}

      {group.conversation_id !== null && (
        <Link
          href={`/${locale}/messages/${group.conversation_id}`}
          className="underline"
          data-testid="group-conversation"
        >
          <Translated locale={locale} message="groupsPage.openConversation" />
        </Link>
      )}

      <section className="flex flex-col gap-2" data-testid="group-members">
        <h2 className="text-lg font-semibold">
          <Translated locale={locale} message="groupsPage.members" />
        </h2>
        {group.members === null ? (
          // Found, not read. Saying so is the point of the middle visibility;
          // an empty list would have said "nobody", which of a group is never
          // true.
          <p className="text-sm text-muted" data-testid="group-members-hidden">
            <Translated locale={locale} message="groupsPage.membersHidden" />
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {group.members.map((member) => (
              <li key={member.username} className="text-sm">
                <MemberName locale={locale} member={member} link className="underline" />{' '}
                <span className="text-muted">
                  <MemberHandle username={member.username} />
                  {member.role === 'member' ? (
                    ''
                  ) : (
                    <>
                      {' · '}
                      {ROLE[member.role] === undefined ? (
                        member.role
                      ) : (
                        <Translated locale={locale} message={ROLE[member.role]!} />
                      )}
                    </>
                  )}
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
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupsPage.board.title" />
          </h2>
          {!board.ok ? (
            <Notice tone="danger" data-testid="group-board-unreachable">
              <Translated locale={locale} message="groupsPage.board.unreachable" />
            </Notice>
          ) : board.data.entries.length === 0 ? (
            // The floor does not bend for a small group (D-037), so a group can
            // have no board at all — and saying which filter produced that is
            // the difference between an honest absence and a page that looks
            // like nobody is here.
            <p className="text-sm text-muted" data-testid="group-board-none">
              <Said
                locale={locale}
                message="groupsPage.board.none"
                params={{ count: formatNumber(locale, board.data.min_settled) }}
              />
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {board.data.entries.map((entry) => (
                  <li key={entry.username} className="flex items-baseline gap-3 text-sm">
                    <span className="w-6 text-end text-muted">
                      {formatNumber(locale, entry.rank)}
                    </span>
                    <MemberName locale={locale} member={entry} link className="underline" />
                    <span className="ms-auto tabular-nums">{ratingLabel(entry)}</span>
                    <span className="text-muted">{tierLabel(entry.tier)}</span>
                    <span className="text-muted">{statusLabel(entry)}</span>
                  </li>
                ))}
              </ol>
              {board.data.total > board.data.entries.length && (
                <p className="text-sm text-muted" data-testid="group-board-more">
                  <Said
                    locale={locale}
                    message="groupsPage.board.more"
                    params={{
                      shown: formatNumber(locale, board.data.entries.length),
                      total: formatNumber(locale, board.data.total),
                    }}
                  />
                </p>
              )}
            </>
          )}
          <p className="text-sm text-muted" data-testid="group-board-note">
            <WithLink
              locale={locale}
              message="groupsPage.board.note"
              link={
                <Link href={`/${locale}/leaderboard`} className="underline">
                  <Translated locale={locale} message="groupsPage.board.global" />
                </Link>
              }
            />
          </p>
        </section>
      )}

      {decides && (
        <section className="flex flex-col gap-3" data-testid="group-queue">
          <h2 className="text-lg font-semibold">
            <Translated locale={locale} message="groupsPage.queue.title" />
          </h2>
          {queue === null || !queue.ok ? (
            <Notice tone="danger" data-testid="group-queue-unreachable">
              <Translated locale={locale} message="groupsPage.queue.unreachable" />
            </Notice>
          ) : queue.data.requests.length === 0 ? (
            <p className="text-sm text-muted" data-testid="group-queue-none">
              <Translated locale={locale} message="groupsPage.queue.none" />
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
        <Translated locale={locale} message="messagesPage.blockingNote" />
      </p>
    </main>
  );
}
