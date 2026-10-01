import type { ConversationSummary, FixtureStatus } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { type MessageKey, interpolate, t } from '@/i18n/messages';
import { memberName } from '@/lib/member-name';

/** A catalogue sentence in the reader's language (T-1309), its values in. */
function say(locale: string, key: MessageKey, params: Record<string, string> = {}): string {
  return interpolate(t(isLocale(locale) ? locale : DEFAULT_LOCALE, key), params);
}

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
export function conversationTitle(
  conversation: ConversationSummary,
  viewer: string,
  locale: string,
): string {
  switch (conversation.kind) {
    case 'direct': {
      // A deleted member is named from the catalogue, never by the stored
      // "Deleted member" (T-908).
      const others = conversation.members
        .filter((member) => member.username !== viewer)
        .map((member) => memberName(locale, member));
      return others.length === 0
        ? say(locale, 'shared.conversation.untitled')
        : others.join(say(locale, 'shared.listSeparator'));
    }
    case 'group':
      return conversation.group?.name ?? say(locale, 'shared.conversation.group');
    case 'group_thread': {
      const group = conversation.group?.name ?? say(locale, 'shared.conversation.group');
      const match = conversation.fixture;
      return match === null
        ? say(locale, 'shared.conversation.threadNoMatch', { group })
        : say(locale, 'shared.conversation.thread', { home: match.home, away: match.away, group });
    }
    default:
      // A kind the contract has and this file has not been taught. Naming it
      // honestly beats naming it wrongly, and the guard makes it a failing test
      // rather than something a reader discovers.
      return say(locale, 'shared.conversation.untitled');
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
export function threadStanding(conversation: ConversationSummary, locale = 'en'): string | null {
  const match = conversation.fixture;
  if (conversation.kind !== 'group_thread' || match === null) return null;
  const key = STATUS_KEY[match.status];
  const status = key === undefined ? match.status : say(locale, key);
  if (match.score === null) return status;
  const n = (value: number): string => formatNumber(locale, value);
  return `${n(match.score.home)}–${n(match.score.away)} · ${status}`;
}

/** A fixture's status in words; the provider's own value only for one the contract lacks. */
const STATUS_KEY: Partial<Record<string, MessageKey>> = {
  scheduled: 'shared.status.scheduled',
  live: 'competitionPage.status.live',
  finished: 'shared.status.finished',
  postponed: 'competitionPage.status.postponed',
  suspended: 'competitionPage.status.suspended',
  cancelled: 'competitionPage.status.cancelled',
  abandoned: 'competitionPage.status.abandoned',
  awarded: 'competitionPage.status.awarded',
} satisfies Record<FixtureStatus, MessageKey>;
