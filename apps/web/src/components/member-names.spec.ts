import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notificationLine } from '@fmip/contracts';
import { EN, TRANSLATION_FILES } from '@/i18n/messages';
import { UNFINISHED_LOCALES } from '@/i18n/locales';
import { memberHandle, memberName, memberProfileHref } from '@/lib/member-name';

/**
 * "A deleted member" wherever a member is named (T-908, D-094).
 *
 * A deleted account keeps a tombstone username (`deleted_` + 12 hex) and a
 * stored `display_name` of the English literal "Deleted member". Neither may
 * reach a page: the web recognises the tombstone with the contract's
 * `isDeletedMember` and names the member with `account.deletedMember` from
 * the catalogue, through `lib/member-name.ts` and `components/member-name.tsx`.
 *
 * The table below is every contract field that carries a member's name. A new
 * one fails the first test until it is added here, either with the place the
 * web renders it through the rule or with the reason it is not a member-facing
 * name.
 */

const WEB = join(__dirname, '..');
const CONTRACTS = join(WEB, '..', '..', '..', 'packages', 'contracts', 'src');

type Rule = { rendered: [file: string, needle: string][] } | { exempt: string };

const STAFF = 'a staff surface, not a member naming a member; it shows the stored record';

const FIELDS: Record<string, Rule> = {
  'admin.ts:AdminUser.display_name': { exempt: STAFF },
  'campaigns.ts:Audience.created_by': { exempt: STAFF },
  'campaigns.ts:Campaign.created_by': { exempt: STAFF },
  // The administrator who dismissed a contributor flag (T-1031): shown only on
  // the console's contributors page.
  'contributor.ts:ContributorFlag.by': { exempt: STAFF },
  'community-analysis.ts:CommunityAnalyst.display_name': {
    rendered: [['components/community-analysis-panel.tsx', 'member={analysis.author}']],
  },
  'conversations.ts:ConversationMember.display_name': {
    rendered: [
      ['lib/conversation-title.ts', 'memberName(locale, member)'],
      ['components/conversation.tsx', 'member={{ username: member.username }}'],
    ],
  },
  'conversations.ts:SharedCard.by': {
    rendered: [['components/conversation.tsx', 'member={{ username: card.by }}']],
  },
  'conversations.ts:Message.author': {
    rendered: [['components/conversation.tsx', 'member={{ username: message.author }}']],
  },
  'conversations.ts:Message.mentions': {
    rendered: [['components/conversation.tsx', 'memberName(locale, { username })']],
  },
  'following-feed.ts:FeedPanelPost.display_name': {
    rendered: [['lib/feed.ts', 'memberName(locale, item.author)']],
  },
  'founder-analysis.ts:FounderAnalysis.display_name': {
    exempt: "the founder's own signed analysis (rule 6), keyed by account id, not a member's",
  },
  'founder-analysis.ts:FounderAnalysisSummary.display_name': {
    exempt: "the founder's own signed analysis (rule 6), keyed by account id, not a member's",
  },
  'groups.ts:GroupMember.display_name': {
    rendered: [['app/[locale]/groups/[slug]/page.tsx', 'member={member}']],
  },
  'groups.ts:GroupInvite.invited_by': {
    rendered: [['app/[locale]/groups/page.tsx', 'member={{ username: invite.invited_by }}']],
  },
  'groups.ts:GroupInviteLink.created_by': {
    exempt:
      'no web page renders the invite-link list yet (T-1021 is API-first); the page that does must render it through the rule',
  },
  'groups.ts:GroupRules.created_by': {
    exempt:
      "not rendered: a group's rules are shown as the owner's (T-1023), never under a member's name",
  },
  'groups.ts:GroupJoinRequest.display_name': {
    rendered: [['app/[locale]/groups/[slug]/page.tsx', 'member={request}']],
  },
  'groups.ts:GroupPoll.created_by': {
    rendered: [['components/group-polls.tsx', 'member={{ username: poll.created_by }}']],
  },
  'identity.ts:AuthUser.display_name': {
    exempt: 'the signed-in member themself; a deleted account cannot sign in',
  },
  'identity.ts:RegisterRequest.display_name': { exempt: 'a request body, not a name shown' },
  'match-panel.ts:PanelAuthor.display_name': {
    rendered: [['components/match-panel.tsx', 'if (isDeletedMember(author.username))']],
  },
  'moderation.ts:AppealNote.author': { exempt: STAFF },
  'moderation.ts:GroupAppealNote.author': {
    exempt:
      'not rendered: an appeal note on a closure shows its words and time, never its author (T-1025)',
  },
  'moderation.ts:QueuedReport.reporter': { exempt: STAFF },
  'moderation.ts:QueueSubject.display_name': { exempt: STAFF },
  'notifications.ts:Notification.source': {
    rendered: [
      ['components/notification-list.tsx', 'notificationLine(notification, deletedMemberLabel)'],
    ],
  },
  'panel-social.ts:FollowedMember.display_name': {
    exempt: 'read for the follow state only (the match page); no page renders it as a name',
  },
  'predictions.ts:FriendPrediction.display_name': {
    rendered: [['components/home-member.tsx', 'member={p}']],
  },
  'predictions.ts:GroupPredictionCall.display_name': {
    rendered: [['components/group-comparison.tsx', 'member={call}']],
  },
  'profile.ts:PublicProfile.display_name': {
    rendered: [['app/[locale]/u/[username]/page.tsx', 'member={profile}']],
  },
  'profile.ts:ProfileView.display_name': {
    rendered: [['app/[locale]/u/[username]/page.tsx', 'member={view}']],
  },
  'profile.ts:UpdateProfileRequest.display_name': { exempt: 'a request body, not a name shown' },
  'search.ts:MemberSearchResult.display_name': {
    rendered: [['app/[locale]/search/page.tsx', 'member={member}']],
  },
  'social.ts:SocialMember.display_name': {
    rendered: [
      ['app/[locale]/friends/page.tsx', 'member={request.member}'],
      ['app/[locale]/friends/page.tsx', 'member={friend.member}'],
      ['app/[locale]/friends/page.tsx', 'member={entry.member}'],
    ],
  },
};

/**
 * Surfaces that name a member by `username` alone (a leaderboard carries no
 * display name). Listed rather than discovered, because `username` is on every
 * member-shaped type; `@{` below keeps a new one from rendering the tombstone.
 */
const USERNAME_ONLY: [file: string, needle: string][] = [
  ['app/[locale]/leaderboard/page.tsx', 'member={entry}'],
  ['app/[locale]/predictions/page.tsx', 'member={entry}'],
  ['app/[locale]/groups/[slug]/page.tsx', 'member={entry}'],
  ['app/[locale]/u/[username]/page.tsx', 'isDeletedMember(name)'],
];

/** Every contract field that names a member, as `file:Type.field`. */
function contractNameFields(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(CONTRACTS)) {
    if (!file.endsWith('.ts') || file.endsWith('.spec.ts')) continue;
    let current = '';
    for (const line of readFileSync(join(CONTRACTS, file), 'utf8').split('\n')) {
      const decl = /^export (?:interface|type|const|function) (\w+)/.exec(line);
      if (decl !== null) current = decl[1]!;
      const field =
        // On its own line, or inline in a nested `{ username; display_name }`.
        /(?:^\s+|[{;,]\s*)(display_name)\??:/.exec(line) ??
        /^\s+(author|by|created_by|invited_by|reporter|source|mentions)\??: string/.exec(line);
      if (field !== null) found.push(`${file}:${current}.${field[1]}`);
    }
  }
  return [...new Set(found)].sort();
}

function webSources(): { path: string; text: string }[] {
  return (readdirSync(WEB, { recursive: true }) as string[])
    .map((path) => path.split(sep).join('/'))
    .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.spec\.tsx?$/.test(path))
    .map((path) => ({ path, text: readFileSync(join(WEB, path), 'utf8') }));
}

const read = (path: string) => readFileSync(join(WEB, path), 'utf8');

describe('every contract field that names a member', () => {
  it('is in the table, so a new one needs a decision', () => {
    expect(contractNameFields()).toEqual(Object.keys(FIELDS).sort());
  });

  for (const [field, rule] of Object.entries(FIELDS)) {
    if ('exempt' in rule) continue;
    it(`${field} is rendered through the rule`, () => {
      for (const [file, needle] of rule.rendered) expect(read(file), file).toContain(needle);
    });
  }

  it('and the username-only surfaces too', () => {
    for (const [file, needle] of USERNAME_ONLY) expect(read(file), file).toContain(needle);
  });
});

describe('the web never renders a stored name or a tombstone handle directly', () => {
  /** Files allowed to read `.display_name`, each with its reason. */
  const DISPLAY_NAME_READERS: Record<string, string> = {
    'lib/member-name.ts': 'the rule itself',
    'components/member-name.tsx': 'the rule itself',
    'components/match-panel.tsx': '`Standing` branches on isDeletedMember first (T-812)',
    'components/founder-analysis.tsx': "the founder's own signed analysis (rule 6)",
    'components/moderation-queue.tsx': STAFF,
    'app/[locale]/admin/page.tsx': STAFF,
    'app/[locale]/settings/page.tsx': "the member's own profile form",
    'lib/share-card.ts': 'public profiles only; a tombstone is private and never reaches it',
  };

  /** Files allowed to render `@{…}`, each with its reason. */
  const HANDLE_RENDERERS: Record<string, string> = {
    'components/member-name.tsx': 'the rule itself',
    'components/match-panel.tsx': '`Standing` branches on isDeletedMember first (T-812)',
    'components/site-header.tsx': 'the signed-in member themself',
    'app/[locale]/settings/page.tsx': 'the signed-in member themself',
    'app/[locale]/register/page.tsx': 'the inviter, from a live invite link',
    'app/[locale]/u/[username]/compare/page.tsx': 'a friend: a deleted account has no friendships',
    'components/friend-controls.tsx': 'controls on a live account (the tombstone page has none)',
    'components/contributors-admin.tsx': STAFF,
    'components/moderation-queue.tsx': STAFF,
    'app/[locale]/admin/page.tsx': STAFF,
    'app/[locale]/admin/moderation/[username]/page.tsx': STAFF,
    'app/[locale]/admin/moderation/groups/[slug]/page.tsx': STAFF,
  };

  it('reads `.display_name` only in the rule and the listed exceptions', () => {
    const readers = webSources()
      .filter(({ text }) => /\.display_name\b/.test(text))
      .map(({ path }) => path);
    expect(readers.filter((path) => !(path in DISPLAY_NAME_READERS))).toEqual([]);
  });

  it('renders `@{…}` only in the rule and the listed exceptions', () => {
    const renderers = webSources()
      .filter(({ path, text }) => path.endsWith('.tsx') && text.includes('@{'))
      .map(({ path }) => path);
    expect(renderers.filter((path) => !(path in HANDLE_RENDERERS))).toEqual([]);
  });

  it('never matches the stored English name', () => {
    const matching = webSources()
      .filter(({ text }) => text.includes("'Deleted member'"))
      .map(({ path }) => path);
    expect(matching).toEqual([]);
  });
});

describe('the rule', () => {
  const gone = { username: 'deleted_0123456789ab', display_name: 'Deleted member' };
  const ada = { username: 'ada', display_name: 'Ada Lovelace' };

  it('names a deleted member from the catalogue, in the reader language', () => {
    expect(memberName('en', gone)).toBe(EN['account.deletedMember']);
    expect(memberName('x-rtl', gone)).toBe(EN['account.deletedMember']);
    expect(memberName('en', ada)).toBe('Ada Lovelace');
    expect(memberName('en', { username: 'ada' })).toBe('@ada');
  });

  it('gives a deleted member no handle and no profile link', () => {
    expect(memberHandle(gone.username)).toBeNull();
    expect(memberProfileHref('en', gone.username)).toBeNull();
    expect(memberHandle('ada')).toBe('@ada');
    expect(memberProfileHref('fa', 'ali_7')).toBe('/fa/u/ali_7');
  });

  it('names a deleted source in a notification line, never by the tombstone', () => {
    const line = (source: string | null, label?: string) =>
      notificationLine({ kind: 'friend_request', source }, label);
    expect(line(gone.username)).toBe('A deleted member sent you a friend request.');
    expect(line(gone.username, 'X')).toBe('X sent you a friend request.');
    expect(line('ada')).toBe('ada sent you a friend request.');
    expect(line(null)).toBe('Somebody sent you a friend request.');
  });
});

describe('the catalogue', () => {
  it('has the key in every catalogue, with no machine text in it (D-066)', () => {
    expect(EN['account.deletedMember']).toBe('A deleted member');
    for (const locale of UNFINISHED_LOCALES) {
      const entry = TRANSLATION_FILES[locale]['account.deletedMember'];
      expect(entry, locale).toBeDefined();
      expect(entry.source, locale).toBe(EN['account.deletedMember']);
      // Untranslated means nobody has written it yet: an empty text, never a
      // guess. A translated or reviewed one is a person's (D-066).
      if (entry.status === 'untranslated') expect(entry.text, locale).toBe('');
      else expect(entry.text, locale).not.toBe('');
    }
  });
});
