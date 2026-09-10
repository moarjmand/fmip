/**
 * Read endpoints over the catalog (T-010 tables). Only what a page needs so
 * far: the country list for registration. Competition, team and player
 * shapes arrive with E3.
 */

export interface CountrySummary {
  id: string;
  /** FIFA trigram, e.g. `ENG`. */
  code: string;
  /** ISO 3166-1 alpha-2 where one exists. */
  iso2: string | null;
  name: string;
}

/** `GET /countries`, sorted by name. */
export interface CountriesResponse {
  countries: CountrySummary[];
}
