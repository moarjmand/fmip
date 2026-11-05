import type { IconName } from '@/components/ui/icons';
import type { MessageKey } from '@/i18n/messages';
import { loginHref, registerHref } from './return-to';

/**
 * The gate's copy (T-1736, D-358): one entry per member-only page, keyed by
 * the page's route. A guest who asks for one of these pages is told its name
 * and, in one sentence, what it gives a member, beside the two ways in
 * (`components/gate-card.tsx`). The sentences are catalogue keys, so every
 * language says them; each says only what the page does today.
 *
 * `returns` is whether the two links carry the page as the return address.
 * The phone's You tab has no page behind it to come back to, so its entry
 * carries none and the account actions land where they always did.
 */
export interface Gate {
  /** The page's own name, as its title says it. */
  title: MessageKey;
  /** One sentence: what the page gives a member. */
  value: MessageKey;
  icon: IconName;
  returns: boolean;
}

export const GATES = {
  '/following': { title: 'feed.title', value: 'gate.following', icon: 'star', returns: true },
  '/following/saved': {
    title: 'saved.title',
    value: 'gate.saved',
    icon: 'bookmark',
    returns: true,
  },
  '/friends': {
    title: 'friendsPage.title',
    value: 'gate.friends',
    icon: 'community',
    returns: true,
  },
  '/notifications': {
    title: 'notificationsPage.title',
    value: 'gate.notifications',
    icon: 'bell',
    returns: true,
  },
  '/settings/notifications': {
    title: 'notificationsPage.settingsTitle',
    value: 'gate.notificationSettings',
    icon: 'bell',
    returns: true,
  },
  '/messages': { title: 'messagesPage.title', value: 'gate.messages', icon: 'chat', returns: true },
  '/groups': { title: 'groupsPage.title', value: 'gate.groups', icon: 'community', returns: true },
  // The matches page's "Not picked yet" view: a member's own picks to make.
  '/scores?unpicked=1': {
    title: 'gate.picks.title',
    value: 'gate.picks',
    icon: 'pick',
    returns: true,
  },
  // Where the phone's You tab leads a guest.
  '/you': { title: 'gate.you.title', value: 'gate.you', icon: 'user', returns: false },
} as const satisfies Record<string, Gate>;

export type GateRoute = keyof typeof GATES;

/** The two ways in from a gate, each carrying the page as the return address when it has one. */
export function gateLinks(locale: string, route: GateRoute): { register: string; login: string } {
  const next = GATES[route].returns ? `/${locale}${route}` : null;
  return { register: registerHref(locale, next), login: loginHref(locale, next) };
}
