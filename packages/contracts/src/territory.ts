/**
 * The viewer's territory (blueprint 11, T-312).
 *
 * A territory is an ISO 3166-1 country, not a football country: broadcast
 * rights are sold by state, and England, Scotland and Wales are three
 * football countries in one territory. It is **chosen by the member and
 * stored, never inferred** from an address -- an IP guess is wrong for anyone
 * travelling, on a VPN or mislabelled, and wrong silently. A member who has
 * not chosen is `not_chosen` and is asked; nothing reads their registration
 * country as an answer to a question they were never asked (rule 3).
 */
export interface Territory {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  /** The English short name; a page may localise it with `Intl.DisplayNames`. */
  name: string;
}

/** `GET /territories`, sorted by name. */
export interface TerritoriesResponse {
  territories: Territory[];
}

export type ViewingTerritory =
  | { state: 'chosen'; territory: Territory }
  /** Not a default and not a guess: the surface asks. */
  | { state: 'not_chosen' };

/** `GET /me/territory`. */
export interface ViewingTerritoryResponse {
  viewing_territory: ViewingTerritory;
}

/** `PUT /me/territory`. `null` clears the choice; an unknown code is refused. */
export interface SetViewingTerritoryRequest {
  code: string | null;
}

export const TERRITORY_CODE = /^[A-Z]{2}$/;
