import type { RateLimitEnforcement, RateLimitSubject } from '@fmip/contracts';

/**
 * The rate-limit inventory (T-811, D-103): every write the API takes -- any
 * method but GET, HEAD and OPTIONS -- is either held by a ceiling below or
 * listed in `EXEMPT` with the reason it needs none. The console security spec
 * (`src/security/console-security.http.spec.ts`) collects the router's routes
 * from Fastify's `onRoute` hook and fails on a write that is in neither, and
 * on an entry here that is no longer a route; the `## Rate limits` section of
 * `docs/02-architecture.md` is this list in prose, and a unit test holds the
 * two together.
 *
 * The numbers are not here: they are rows in `rate_limit`, which an
 * administrator changes with an UPDATE, and `GET /admin/rate-limits` reads
 * them at request time.
 */

export interface CeilingDefinition {
  /** The `rate_limit` row. */
  action: string;
  subject: RateLimitSubject;
  enforced: RateLimitEnforcement;
  what: string;
  /**
   * `METHOD /path` as the router registers it: writes, and the one read whose
   * work is a model call (`GET /ask`, T-838).
   */
  routes: readonly string[];
}

export const CEILINGS: readonly CeilingDefinition[] = [
  // Before signing in (T-810, D-093): counted in `auth_rate_window` by the
  // identity module, which also counts its own refusals.
  {
    action: 'login_failure_account',
    subject: 'identifier',
    enforced: 'api',
    what: 'Wrong passwords for one identifier typed (a success is given back). Also the password check of deleting an account and of downloading a copy of its data, against its username.',
    routes: ['POST /auth/login', 'POST /auth/account/delete', 'POST /auth/account/export'],
  },
  {
    action: 'login_failure_ip',
    subject: 'address',
    enforced: 'api',
    what: 'Wrong passwords from one network address, on sign-in, on deleting an account and on downloading a copy of its data.',
    routes: ['POST /auth/login', 'POST /auth/account/delete', 'POST /auth/account/export'],
  },
  {
    action: 'register_account',
    subject: 'identifier',
    enforced: 'api',
    what: 'Registrations attempted with one e-mail address.',
    routes: ['POST /auth/register'],
  },
  {
    action: 'register_ip',
    subject: 'address',
    enforced: 'api',
    what: 'Registrations attempted from one network address.',
    routes: ['POST /auth/register'],
  },
  {
    action: 'password_forgot_account',
    subject: 'identifier',
    enforced: 'api',
    what: 'Reset e-mails asked for one address.',
    routes: ['POST /auth/password/forgot'],
  },
  {
    action: 'password_forgot_ip',
    subject: 'address',
    enforced: 'api',
    what: 'Reset e-mails asked for from one network address.',
    routes: ['POST /auth/password/forgot'],
  },
  {
    action: 'email_token_ip',
    subject: 'address',
    enforced: 'api',
    what: 'Uses of the two e-mailed links (verify, reset) from one network address.',
    routes: ['POST /auth/verify-email', 'POST /auth/password/reset'],
  },

  // A member reaching other people (T-213 and after): a trigger on the insert
  // counts in `rate_window`, so no caller can route around it.
  {
    action: 'friend_request',
    subject: 'member',
    enforced: 'database',
    what: 'Friend requests sent.',
    routes: ['POST /me/friend-requests/:username'],
  },
  {
    action: 'message',
    subject: 'member',
    enforced: 'database',
    what: 'Messages written, in direct conversations, groups and match threads.',
    routes: ['POST /me/conversations/:id/messages'],
  },
  {
    action: 'group_create',
    subject: 'member',
    enforced: 'database',
    what: 'Groups created.',
    routes: ['POST /groups'],
  },
  {
    action: 'group_invite',
    subject: 'member',
    enforced: 'database',
    what: 'Group invitations sent.',
    routes: ['POST /groups/:slug/invites/:username'],
  },
  {
    action: 'group_invite_link',
    subject: 'member',
    enforced: 'database',
    what: 'Group invite links made.',
    routes: ['POST /groups/:slug/invite-links'],
  },
  {
    action: 'group_join_request',
    subject: 'member',
    enforced: 'database',
    what: 'Requests to join a group.',
    routes: ['POST /groups/:slug/requests'],
  },
  {
    action: 'group_thread',
    subject: 'member',
    enforced: 'database',
    what: "Match threads opened in a group's conversation.",
    routes: ['POST /groups/:slug/threads'],
  },
  {
    action: 'group_poll_create',
    subject: 'member',
    enforced: 'database',
    what: 'Polls created in a group.',
    routes: ['POST /groups/:slug/polls'],
  },
  {
    action: 'panel_post',
    subject: 'member',
    enforced: 'database',
    what: "Posts on a match's panel.",
    routes: ['POST /fixtures/:id/panel'],
  },

  // Found by this inventory (T-811, D-103): counted in `rate_window` by the
  // API before the work, because the work is the cost.
  {
    action: 'briefing',
    subject: 'member',
    enforced: 'api',
    what: 'Briefings asked for: each is a call to the language model.',
    routes: ['POST /me/briefing'],
  },
  {
    action: 'push_subscription',
    subject: 'member',
    enforced: 'api',
    what: 'Push endpoints registered: every notification is sent to each one.',
    routes: ['POST /me/push-subscriptions'],
  },

  // Not a write, and the one read with a ceiling (T-838, D-103's gap): every
  // question is a model call, and the route is public. A member is counted
  // in `rate_window`, a guest in `auth_rate_window` under their address's
  // HMAC; both before the model is called.
  {
    action: 'ask',
    subject: 'member',
    enforced: 'api',
    what: "A member's questions to the search: each is a call to the language model.",
    routes: ['GET /ask'],
  },
  {
    action: 'ask_ip',
    subject: 'address',
    enforced: 'api',
    what: "A signed-out reader's questions to the search from one network address: each is a call to the language model.",
    routes: ['GET /ask'],
  },
];

// The reasons, shared where many writes have the same one.
const OWN_SETTING =
  "Overwrites the caller's own setting in place: a repeat replaces rather than adds, and reaches nobody.";
const OWN_STATE =
  "Changes only the caller's own state (read, muted, left, withdrawn); a repeat is a no-op and reaches nobody.";
const TOGGLE =
  'One row per member and target at most (a primary key), added or removed; a repeat changes nothing, and any notice it raises is deduplicated per member and target.';
const REMOVAL =
  "Removes the caller's own row, or one they are entitled to remove; a removal can only happen as often as something was added, and the adding is what is limited.";
const ANSWER =
  'Answers an invitation or request that already exists; each can be answered once, so it is bounded by the ceiling on sending them.';
const GROUP_ADMIN =
  "A group owner's or moderator's decision on their own group's members or settings; bounded by the group's membership, and never reaches anyone outside it.";
const ROLE_GATED =
  'Role-gated (the security spec, GATED_ELSEWHERE): only an administrator or the founder can call it, and the caller is the operator.';

/**
 * Every write outside `/admin` that has no ceiling, and why it needs none.
 * `POST /reports` and the appeal are deliberately unlimited: see their rows.
 */
export const EXEMPT: Readonly<Record<string, string>> = {
  // Accounts.
  'POST /auth/logout': "Ends the caller's own session; nothing is created.",

  // A member's own settings and lists.
  'PATCH /me/profile': OWN_SETTING,
  'PATCH /me/preferences': OWN_SETTING,
  'PATCH /me/privacy': OWN_SETTING,
  'PUT /me/territory': OWN_SETTING,
  'PUT /me/first-run': OWN_SETTING,
  'PUT /me/notification-settings/:kind': OWN_SETTING,
  'PUT /me/quiet-hours': OWN_SETTING,
  'DELETE /me/quiet-hours': OWN_SETTING,
  'PUT /me/notification-mutes/:scope/:target': OWN_SETTING,
  'DELETE /me/notification-mutes/:scope/:target': OWN_SETTING,
  'DELETE /me/push-subscriptions': REMOVAL,
  'POST /me/notifications/read': OWN_STATE,
  'POST /me/notifications/:id/read': OWN_STATE,
  'PUT /me/following/:type/:id':
    'One row per member and followed team, competition or player (a primary key); bounded by the catalogue, and reaches nobody.',
  'DELETE /me/following/:type/:id': REMOVAL,
  'PUT /me/saved-articles/:storyId':
    'One row per member and story (a primary key); bounded by the stories, and reaches nobody.',
  'DELETE /me/saved-articles/:storyId': REMOVAL,
  'POST /me/rating/recompute':
    "Recomputes the caller's own rating from stored rows (rule 8); a snapshot is written only when the value changed, so a repeat writes nothing.",
  'POST /me/points/award':
    "Awards the caller's settlements not yet counted; a repeat finds none and adds nothing.",

  // Predictions and analysis.
  'PUT /fixtures/:fixtureId/prediction':
    'One prediction per member per match, replaced in place until kick-off; the friends it tells are told once per match (a dedupe key).',
  'PUT /me/analyses/:fixtureId':
    'One draft per member per match, overwritten in place; nobody reads it until it is submitted.',
  'POST /me/analyses/:fixtureId/submit':
    'One submission of a draft waits for its decision: a second attempt while one is pending is refused (already_decided), so the review queue grows by at most one per member per match.',

  // Safety: never gated by a clock (T-213).
  'POST /reports':
    'Deliberately unlimited (T-213): reporting is limited by target instead -- one open report per subject (T-210) -- because a member harassed by twenty accounts must be able to report twenty.',
  'POST /me/sanctions/:id/appeal':
    'Deliberately unlimited (T-213): an appeal is the way out of a sanction, and the exit is never gated; only the sanctioned member can write, on their own sanction, and each note is length-capped.',
  'POST /me/blocks/:username':
    'Deliberately unlimited: a block protects the caller, reaches nobody, and is one row per pair.',
  'DELETE /me/blocks/:username': REMOVAL,

  // Friends and follows.
  'POST /me/friend-requests/:username/accept': ANSWER,
  'DELETE /me/friend-requests/:username': ANSWER,
  'DELETE /me/friends/:username': REMOVAL,
  'PUT /members/:username/follow': TOGGLE,
  'DELETE /members/:username/follow': REMOVAL,
  'PUT /panel-posts/:postId/reactions/:reaction': TOGGLE,
  'DELETE /panel-posts/:postId/reactions/:reaction': REMOVAL,
  'DELETE /fixtures/:id/panel/:postId': REMOVAL,

  // Conversations.
  'POST /me/conversations/direct/:username':
    'Friends only, and one direct conversation per pair (a unique index): a repeat returns the same conversation. The messages in it are what is limited.',
  'DELETE /me/conversations/:id/messages/:messageId': REMOVAL,
  'PUT /me/conversations/:id/messages/:messageId/reactions/:reaction': TOGGLE,
  'DELETE /me/conversations/:id/messages/:messageId/reactions/:reaction': REMOVAL,
  'POST /me/conversations/:id/messages/:messageId/pin':
    "A participant's mark on a message already sent, one per message; bounded by the messages, which are limited.",
  'DELETE /me/conversations/:id/messages/:messageId/pin': REMOVAL,
  'POST /me/conversations/:id/read': OWN_STATE,
  'POST /me/conversations/:id/mute': OWN_STATE,
  'DELETE /me/conversations/:id/mute': OWN_STATE,
  'POST /me/conversations/:id/leave': OWN_STATE,

  // Groups.
  'PATCH /groups/:slug': GROUP_ADMIN,
  'DELETE /groups/:slug': GROUP_ADMIN,
  'POST /groups/:slug/members':
    'Joins an open group: one membership per member and group (a primary key), and joining tells nobody.',
  'DELETE /groups/:slug/members/me': OWN_STATE,
  'PUT /groups/:slug/members/:username/role': GROUP_ADMIN,
  'PUT /groups/:slug/invite-policy': GROUP_ADMIN,
  'PUT /groups/:slug/rules': GROUP_ADMIN,
  'POST /me/conversations/:id/messages/:messageId/removal': GROUP_ADMIN,
  'POST /groups/:slug/closure/appeal':
    "The owner's notes on the appeal of their own group's closure (T-1025): only the owner of a closed group can write one, as with a sanction's appeal (`POST /me/sanctions/:id/appeal`).",
  'POST /groups/:slug/rules/seen': OWN_STATE,
  'DELETE /groups/:slug/members/:username': GROUP_ADMIN,
  'DELETE /groups/:slug/invites/:username': REMOVAL,
  'DELETE /groups/:slug/invite-links/:id': REMOVAL,
  'POST /group-invite-links/:token':
    "Follows an invite link: each link lets in at most its own use cap, which its maker's ceiling bounds; the token is 256 random bits, so trying tokens is not a route in; a join request filed this way is counted by the join-request ceiling.",
  'POST /me/group-invites/:slug/accept': ANSWER,
  'DELETE /me/group-invites/:slug': ANSWER,
  'POST /groups/:slug/requests/:username/accept': ANSWER,
  'DELETE /groups/:slug/requests/:username': ANSWER,
  'DELETE /me/group-requests/:slug': REMOVAL,
  'PUT /groups/:slug/polls/:pollId/vote':
    'One vote per member per poll, replaced in place; reaches nobody.',
  'DELETE /groups/:slug/polls/:pollId/vote': REMOVAL,
  'POST /groups/:slug/polls/:pollId/close': GROUP_ADMIN,
  'POST /groups/:slug/polls/:pollId/removal': GROUP_ADMIN,

  // Role-gated writes outside the console.
  'POST /fixtures/:fixtureId/forecasts': ROLE_GATED,
  'POST /fixtures/:fixtureId/power-index': ROLE_GATED,
  'POST /fixtures/:fixtureId/evaluations': ROLE_GATED,
  'POST /fixtures/:fixtureId/settle': ROLE_GATED,
  'POST /settlements/run': ROLE_GATED,
  'POST /ratings/recompute': ROLE_GATED,
  'POST /fixtures/:fixtureId/founder-analysis': ROLE_GATED,
};

/** Every write under this prefix is the console's: role-gated and audited, never rate limited. */
export const CONSOLE_PREFIX = '/admin';
export const CONSOLE_REASON =
  "The administration console: every route is role-gated (the security spec's CONSOLE table) and every write is audited with a reason; the caller is an operator, not a member.";

/** Whether a `METHOD /path` is a write. */
export function isWrite(route: string): boolean {
  return !/^(GET|HEAD|OPTIONS) /.test(route);
}

/** The ceilings that hold a route, by the router's `METHOD /path`. */
export function ceilingsOf(route: string): CeilingDefinition[] {
  return CEILINGS.filter((ceiling) => ceiling.routes.includes(route));
}

/**
 * What the inventory says about a write: its ceilings, its exemption, the
 * console, or nothing -- and nothing is what the security spec fails on.
 */
export function coverageOf(
  route: string,
):
  | { kind: 'limited'; actions: string[] }
  | { kind: 'exempt'; reason: string }
  | { kind: 'missing' } {
  const held = ceilingsOf(route);
  if (held.length > 0) return { kind: 'limited', actions: held.map((c) => c.action) };
  const reason = EXEMPT[route];
  if (reason !== undefined) return { kind: 'exempt', reason };
  const path = route.split(' ')[1] ?? '';
  if (path === CONSOLE_PREFIX || path.startsWith(`${CONSOLE_PREFIX}/`)) {
    return { kind: 'exempt', reason: CONSOLE_REASON };
  }
  return { kind: 'missing' };
}

/**
 * The one ceiling a refused (429) request on this route was refused by, when
 * the API must count it after the fact: a database-enforced ceiling, whose
 * trigger rolled its own count back. `null` for a route whose refusals are
 * counted where they are decided (the API-enforced ones), or that has none.
 */
export function refusalCountedOnResponse(method: string, url: string | undefined): string | null {
  if (url === undefined) return null;
  const held = ceilingsOf(`${method} ${url}`).filter((c) => c.enforced === 'database');
  return held.length === 1 ? (held[0]?.action ?? null) : null;
}
