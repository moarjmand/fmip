import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Group, GroupHistoryEntry, GroupInviteLink } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions need a request; the sections only bind them.
vi.mock('@/lib/group-settings-actions', () => {
  const action = async () => null;
  return {
    setInvitePolicyAction: action,
    updateGroupAboutAction: action,
    createInviteLinkAction: action,
    revokeInviteLinkAction: action,
  };
});

const { GroupHistory, GroupInviteLinks, GroupOwnerSettings } = await import('./group-settings');

/**
 * Running a group from its page (T-1026). Each section draws what the API
 * sent: the policy the group has, the favourite it has (by id), a list of
 * links without a single token in it, a revoke control only on a live link,
 * and a history that says who, when, why and what it was before.
 */

const HERE = __dirname;
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'groups', '[slug]', 'page.tsx'),
  'utf8',
);
const HISTORY_PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'groups', '[slug]', 'history', 'page.tsx'),
  'utf8',
);
const SOURCES = [
  readFileSync(join(HERE, 'group-settings.tsx'), 'utf8'),
  readFileSync(join(HERE, 'invite-link-create.tsx'), 'utf8'),
];

const TEAM = '00000000-0000-4000-8000-000000000601';
const COMP = '00000000-0000-4000-8000-000000000201';

const group = (over: Partial<Group> = {}): Group =>
  ({
    id: 'g1',
    slug: 'derby-club',
    name: 'Derby club',
    description: null,
    visibility: 'public',
    member_count: 3,
    created_at: '2026-09-01T00:00:00.000Z',
    language: null,
    favourite: null,
    standing: 'owner',
    conversation_id: null,
    members: [],
    pending: null,
    rules: null,
    rules_accepted_version: null,
    rules_changed: false,
    closed: null,
    invite_policy: 'owner_and_moderators',
    may_invite: true,
    ...over,
  }) as Group;

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data, setCookie: null });
const down = { ok: false as const, status: 0, error: null, setCookie: null };

const link = (over: Partial<GroupInviteLink> = {}): GroupInviteLink => ({
  id: 'l1',
  created_by: 'bo',
  created_at: '2026-09-28T10:00:00.000Z',
  expires_at: '2026-10-05T10:00:00.000Z',
  max_uses: 25,
  uses: 2,
  revoked_at: null,
  state: 'live',
  ...over,
});

describe("the owner's settings", () => {
  const teams = [{ id: TEAM, name: 'Rovers' }] as never;
  const competitions = [{ id: COMP, name: 'The League' }] as never;

  it('checks the policy the group has, and offers all three', () => {
    const html = renderToStaticMarkup(
      <GroupOwnerSettings locale="en" group={group()} teams={teams} competitions={competitions} />,
    );
    expect(html).toContain('checked="" value="owner_and_moderators"');
    expect(html).toContain('value="owner"');
    expect(html).toContain('value="members"');
  });

  it('selects the favourite by id, and offers clubs and competitions by id', () => {
    const html = renderToStaticMarkup(
      <GroupOwnerSettings
        locale="en"
        group={group({ language: 'pt', favourite: { type: 'team', id: TEAM, name: 'Rovers' } })}
        teams={teams}
        competitions={competitions}
      />,
    );
    expect(html).toContain(`value="team:${TEAM}" selected`);
    expect(html).toContain(`value="competition:${COMP}"`);
    expect(html).toContain('value="pt" selected');
  });

  it('does not offer the favourite when the list cannot be fetched, and says so', () => {
    const html = renderToStaticMarkup(
      <GroupOwnerSettings locale="en" group={group()} teams={null} competitions={competitions} />,
    );
    expect(html).not.toContain('name="favourite"');
    expect(html).toContain('data-testid="group-about-favourite-unavailable"');
  });

  it('keeps a language the site does not offer rather than dropping it', () => {
    const html = renderToStaticMarkup(
      <GroupOwnerSettings
        locale="en"
        group={group({ language: 'fa' })}
        teams={teams}
        competitions={competitions}
      />,
    );
    expect(html).toContain('value="fa" selected');
  });
});

describe('invite links', () => {
  const render = (result: Parameters<typeof GroupInviteLinks>[0]['result']) =>
    renderToStaticMarkup(
      <GroupInviteLinks locale="en" slug="derby-club" timeZone="UTC" result={result} />,
    );

  it('says so when there are none, and when they cannot be fetched', () => {
    expect(render(ok({ links: [] }))).toContain('data-testid="group-links-none"');
    expect(render(down)).toContain('data-testid="group-links-unreachable"');
  });

  it('offers revoking only a live link, and never shows a token', () => {
    const html = render(
      ok({ links: [link(), link({ id: 'l2', state: 'revoked', revoked_at: 'x' })] }),
    );
    expect(html.match(/data-testid="group-link-revoke"/g)).toHaveLength(1);
    expect(html).toContain('Revoked');
    expect(html).toContain('2 / 25');
    expect(html).not.toContain('group-invite/');
  });

  it('offers the make-a-link form with an expiry and a use cap', () => {
    const html = render(ok({ links: [] }));
    expect(html).toContain('name="expires_in_hours"');
    expect(html).toContain('name="max_uses"');
    expect(html).toContain('30 days');
  });
});

describe("the group's history", () => {
  const entry: GroupHistoryEntry = {
    action: 'user_group.invite_policy',
    actor: 'bo',
    reason: 'Too many strangers.',
    previous: { invite_policy: 'members' },
    next: { invite_policy: 'owner' },
    created_at: '2026-09-28T10:00:00.000Z',
  };

  it('says who, when, why, and what it was before and after', () => {
    const html = renderToStaticMarkup(
      <GroupHistory locale="en" timeZone="UTC" result={ok({ history: [entry] })} />,
    );
    expect(html).toContain('Who may invite changed');
    expect(html).toContain('Too many strangers.');
    expect(html).toContain('Every member');
    expect(html).toContain('Only the owner');
    expect(html).toContain('@bo');
  });

  it('says so when there is none, and when it cannot be fetched', () => {
    expect(
      renderToStaticMarkup(
        <GroupHistory locale="en" timeZone="UTC" result={ok({ history: [] })} />,
      ),
    ).toContain('data-testid="group-history-none"');
    expect(
      renderToStaticMarkup(<GroupHistory locale="en" timeZone="UTC" result={down} />),
    ).toContain('data-testid="group-history-unreachable"');
  });
});

describe('on the page', () => {
  it('asks nothing of a closed group, and the settings only for its owner', () => {
    expect(PAGE).toContain('const running = group.closed === null;');
    expect(PAGE).toContain("const owns = running && group.standing === 'owner';");
    expect(PAGE).toContain('running && inside && (group.may_invite || decides)');
  });

  it('links the history for the owner and moderators, and the history page sends anybody else back', () => {
    expect(PAGE).toContain('data-testid="group-history-link"');
    expect(HISTORY_PAGE).toContain(
      "if (standing !== 'owner' && standing !== 'moderator') redirect(groupHref);",
    );
  });

  it('uses no physical sides', () => {
    for (const source of SOURCES) {
      expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-(?:\d)|text-(?:left|right)/);
    }
  });
});
