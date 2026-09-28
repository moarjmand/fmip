import type { MatchPanelPage, Message } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { directionOf } from '@/i18n/locales';
import { t } from '@/i18n/messages';

// The server actions need a request; the components only bind them.
vi.mock('@/lib/panel-actions', () => ({ postToPanelAction: async () => null }));
vi.mock('@/lib/panel-social-actions', () => ({
  setFollowAction: async () => null,
  setPanelReactionAction: async () => null,
}));

const { MessageRow } = await import('./conversation');
const { MatchPanel } = await import('./match-panel');

/**
 * A deleted member under the right-to-left pseudo-locale (T-908, rule 7).
 *
 * A conversation and a match panel, each with a message or post from a
 * deleted account, rendered in `x-rtl`. The member is "a deleted member" from
 * the catalogue: never the tombstone username, never the stored English
 * "Deleted member", with no handle, no profile link and no follow control, and
 * nothing in what is rendered uses a physical side.
 */

const LOCALE = 'x-rtl';
const TOMBSTONE = 'deleted_0123456789ab';
const LABEL = t(LOCALE, 'account.deletedMember');
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function expectDeletedMember(html: string) {
  expect(html).toContain(LABEL);
  expect(html).not.toContain(TOMBSTONE);
  expect(html).not.toContain('Deleted member');
  expect(html).not.toContain('/u/');
  expect(html).not.toMatch(PHYSICAL);
}

describe('a deleted member, right to left', () => {
  it('is the pseudo-locale, right to left', () => {
    expect(directionOf(LOCALE)).toBe('rtl');
  });

  it('in a conversation', () => {
    const message: Message = {
      id: 'm1',
      seq: 1,
      author: TOMBSTONE,
      body: 'Kept, under no name.',
      reply_to_id: null,
      created_at: '2026-09-01T12:00:00.000Z',
      removed: null,
      card: null,
      reactions: [],
      mentions: [TOMBSTONE],
      pinned: false,
    };
    const html = renderToStaticMarkup(
      <MessageRow message={message} locale={LOCALE} timeZone="UTC" isMine={false} />,
    );
    expectDeletedMember(html);
    expect(html).toContain('Kept, under no name.');
  });

  it('in a match panel', () => {
    const page = {
      state: 'open',
      posts: [
        {
          id: 'p1',
          author: {
            username: TOMBSTONE,
            display_name: 'Deleted member',
            rating: 61.2,
            tier: 'gold',
            approved: false,
          },
          body: 'The post stays.',
          created_at: '2026-09-01T12:00:00.000Z',
          removed: null,
          reactions: [],
        },
      ],
      cursor: null,
      total: 1,
    } as unknown as MatchPanelPage;
    const html = renderToStaticMarkup(
      <MatchPanel
        locale={LOCALE}
        fixtureId="f1"
        page={page}
        permission={null}
        reachable
        me="ada"
        followed={[]}
        deletedMemberLabel={LABEL}
      />,
    );
    expectDeletedMember(html);
    expect(html).toContain('data-testid="panel-author-deleted"');
    expect(html).not.toContain('panel-follow-');
    expect(html).toContain('The post stays.');
  });
});
