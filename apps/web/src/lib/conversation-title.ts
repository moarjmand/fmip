import type { ConversationSummary } from '@fmip/contracts';

/**
 * What to call a conversation in a list (T-244).
 *
 * Every kind gets a branch, because the failure this file exists to prevent is
 * the quiet one: a group's room and a group's match threads all carry the same
 * `group` and no `members`, so a list that titled them by their group alone
 * would show four entries with one name and no way to tell them apart.
 *
 * Nothing is invented. A direct conversation is named by whoever else is in it,
 * a group's room by the group, a thread by the match **and** the group — "a
 * thread is a conversation about a fixture, and says which". A thread whose
 * fixture no longer resolves says the group and that a match is missing, rather
 * than naming a match the product cannot see (rule 3).
 */
export function conversationTitle(conversation: ConversationSummary, viewer: string): string {
  switch (conversation.kind) {
    case 'direct': {
      const others = conversation.members
        .filter((member) => member.username !== viewer)
        .map((member) => member.display_name);
      return others.length === 0 ? 'A conversation' : others.join(', ');
    }
    case 'group':
      return conversation.group?.name ?? 'A group';
    case 'group_thread': {
      const group = conversation.group?.name ?? 'A group';
      const match = conversation.fixture;
      return match === null ? `${group} · a match` : `${match.home} v ${match.away} · ${group}`;
    }
    default:
      // A kind the contract has and this file has not been taught. Naming it
      // honestly beats naming it wrongly, and the guard makes it a failing test
      // rather than something a reader discovers.
      return 'A conversation';
  }
}

/**
 * The one line under the title: the match's standing for a thread, nothing for
 * anything else.
 *
 * The score is the one the fixture has now and arrives with its own
 * `last_updated_at` (rule 4) — a thread about a match that finished an hour ago
 * does not still say it is scheduled.
 */
export function threadStanding(conversation: ConversationSummary): string | null {
  const match = conversation.fixture;
  if (conversation.kind !== 'group_thread' || match === null) return null;
  return match.score === null
    ? match.status
    : `${match.score.home}–${match.score.away} · ${match.status}`;
}
