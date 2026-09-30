import type { GroupPredictionComparison, MatchPanelPage, Message } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the components only bind them.
vi.mock('@/lib/panel-actions', () => ({ postToPanelAction: async () => null }));
vi.mock('@/lib/panel-social-actions', () => ({
  setFollowAction: async () => null,
  setPanelReactionAction: async () => null,
}));
vi.mock('@/lib/friend-actions', () => ({
  acceptFriendRequestAction: async () => null,
  blockAction: async () => null,
  sendFriendRequestAction: async () => null,
  unblockAction: async () => null,
  unfriendAction: async () => null,
  withdrawFriendRequestAction: async () => null,
}));
vi.mock('@/lib/group-actions', () => ({
  acceptGroupInviteAction: async () => null,
  answerJoinRequestAction: async () => null,
  appealGroupClosureAction: async () => null,
  askToJoinGroupAction: async () => null,
  declineGroupInviteAction: async () => null,
  followInviteLinkAction: async () => null,
  groupRulesSeenAction: async () => null,
  setGroupRulesAction: async () => null,
  joinGroupAction: async () => null,
  leaveGroupAction: async () => null,
  withdrawGroupRequestAction: async () => null,
}));

const { FriendControls } = await import('./friend-controls');
const { GroupControls } = await import('./group-controls');
const { GroupComparison } = await import('./group-comparison');
const { MessageRow } = await import('./conversation');
const { MatchPanel } = await import('./match-panel');

/**
 * The community surfaces in Persian (T-1308, D-175): friends, groups,
 * conversations and the match panel render their own words from the Persian
 * catalogue on `/fa`, with Persian digits, and say exactly what they said
 * before on `/en`.
 */

/** Nothing marked as an English fallback: every word here has Persian. */
function expectAllPersian(html: string) {
  expect(html).not.toContain('data-translation="untranslated"');
}

describe('the community surfaces on /fa', () => {
  it('names the viewer’s own block in Persian, with the handle kept', () => {
    const html = renderToStaticMarkup(
      <FriendControls locale="fa" username="sara" status="blocked" />,
    );
    expect(html).toContain('@sara را مسدود کرده‌اید. او از این موضوع باخبر نمی‌شود.');
    expect(html).toContain('رفع مسدودیت');
    expectAllPersian(html);
  });

  it('says in English exactly what it said before on /en', () => {
    const html = renderToStaticMarkup(
      <FriendControls locale="en" username="sara" status="blocked" />,
    );
    expect(html).toContain('You blocked @sara. They are not told.');
    expect(html).toContain('Unblock');
  });

  it('tells an owner how leaving works, in Persian', () => {
    const html = renderToStaticMarkup(<GroupControls locale="fa" slug="g" standing="owner" />);
    expect(html).toContain('شما مالک این گروه هستید.');
    expectAllPersian(html);
  });

  it('asks to join with the rules box in Persian', () => {
    const html = renderToStaticMarkup(
      <GroupControls locale="fa" slug="g" standing="may_ask" rulesVersion={2} />,
    );
    expect(html).toContain('قوانین این گروه را خوانده‌ام و می‌پذیرم.');
    expect(html).toContain('درخواست عضویت');
    expectAllPersian(html);
  });

  it('writes a group’s calls with Persian digits and Persian verdicts', () => {
    const comparison = {
      fixture_id: 'f',
      locked: false,
      silent: 0,
      withheld: 0,
      calls: [
        {
          username: 'sara',
          display_name: 'Sara',
          version: { outcome: 'home', score: { home: 2, away: 1 }, confidence: 4 },
          revisions: 3,
          settlement: null,
        },
      ],
    } as unknown as GroupPredictionComparison;
    const html = renderToStaticMarkup(
      <GroupComparison comparison={comparison} locale="fa" groupName="یاران" />,
    );
    expect(html).toContain('پیش‌بینی‌های یاران');
    expect(html).toContain('برد میزبان');
    expect(html).toContain('اطمینان ۴ از ۵');
    expect(html).toContain('۲ بار تغییر کرده');
    expect(html).toContain('هنوز تسویه نشده');
    expect(html).toContain('۲–۱');
    expectAllPersian(html);
  });

  it('marks a removed message and who removed it, in Persian', () => {
    const message = {
      id: 'm',
      seq: 1,
      author: 'sara',
      body: null,
      card: null,
      created_at: '2026-10-01T18:30:00Z',
      removed: { by: 'moderator', reason: 'تبلیغ' },
      mentions: [],
      reactions: [],
      pinned: false,
    } as unknown as Message;
    const html = renderToStaticMarkup(
      <MessageRow message={message} locale="fa" timeZone="Asia/Tehran" isMine={false} />,
    );
    expect(html).toContain('ناظر آن را حذف کرد.');
    expect(html).toContain('دلیل: تبلیغ');
    // The Solar Hijri date, in Persian digits (D-175).
    expect(html).toMatch(/۱۴۰۵/);
  });

  it('says the match discussion is empty, in Persian', () => {
    const page = { state: 'open', posts: [], cursor: null, total: 0 } as unknown as MatchPanelPage;
    const html = renderToStaticMarkup(
      <MatchPanel
        locale="fa"
        fixtureId="f"
        page={page}
        permission={null}
        reachable
        deletedMemberLabel="کاربر حذف‌شده"
      />,
    );
    expect(html).toContain('میزگرد مسابقه');
    expect(html).toContain('هنوز کسی درباره‌ی این بازی مطلبی ننوشته است.');
    expectAllPersian(html);
  });
});
