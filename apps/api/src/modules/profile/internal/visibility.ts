import type { PrivacyVisibility } from '@fmip/contracts';

/**
 * The one rule of profile privacy, as a pure function so it can be tested
 * without a database and read without scrolling.
 *
 *   - The owner always sees their own profile.
 *   - `public`  : anyone, signed in or not.
 *   - `friends` : a signed-in viewer the oracle says is a friend.
 *   - `private` : nobody but the owner.
 */
export function canView(
  visibility: PrivacyVisibility,
  ownerId: string,
  viewerId: string | null,
  areFriends: boolean,
): boolean {
  if (viewerId !== null && viewerId === ownerId) return true;

  switch (visibility) {
    case 'public':
      return true;
    case 'friends':
      return viewerId !== null && areFriends;
    case 'private':
      return false;
  }
}

/**
 * Whether two members are friends. Friendships are Phase 2 (blueprint 8,
 * "Not in Phase 1"), so the only implementation today answers no, and a
 * friends-only profile is therefore visible to its owner alone. When
 * friendships arrive, this port gets a real implementation and nothing in
 * `canView` changes.
 */
export interface FriendshipOracle {
  areFriends(a: string, b: string): Promise<boolean>;
}

export const FRIENDSHIP_ORACLE = Symbol('FRIENDSHIP_ORACLE');

export class NoFriendshipsYet implements FriendshipOracle {
  async areFriends(): Promise<boolean> {
    return false;
  }
}
