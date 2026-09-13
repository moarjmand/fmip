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
 * Whether two members are friends.
 *
 * A port rather than a query, because the answer belongs to the social
 * boundary (blueprint 8.1) and `canView` belongs to this one. `ProfileModule`
 * binds it to `SocialService.areFriends` (T-201); before friendships existed
 * the only implementation answered no, and a friends-only profile was
 * therefore visible to its owner alone. Nothing in `canView` changed when the
 * real one arrived, which is what the port was for.
 */
export interface FriendshipOracle {
  areFriends(a: string, b: string): Promise<boolean>;
}

export const FRIENDSHIP_ORACLE = Symbol('FRIENDSHIP_ORACLE');
