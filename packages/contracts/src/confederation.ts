/**
 * Football's six confederations (T-1643, D-301): which one a competition
 * belongs to, so the header's competitions menu can file it by region. The
 * catalogue stores no continent and no confederation, so it is derived from
 * what the catalogue does store, never from a name (rule 1):
 *
 * - a domestic competition: its country's FIFA trigram (`country.code`)
 *   through `CONFEDERATION_BY_COUNTRY`, every FIFA member association by the
 *   confederation it plays in (Australia in the AFC, Israel and Kazakhstan in
 *   UEFA, Guyana and Suriname in CONCACAF);
 * - a continental competition: the confederation of the domestic leagues its
 *   clubs play in this season (`continentalConfederation`), counted by the
 *   API from the fixtures it holds;
 * - an international one (national teams): none; the menu files those
 *   together whatever the continent.
 *
 * `null` whenever the data does not say: a country code outside the table,
 * a continental competition with no club we can place, or a tie. The menu
 * then files it under "Other competitions" rather than guessing (rule 3).
 */
export const CONFEDERATIONS = ['uefa', 'afc', 'caf', 'concacaf', 'conmebol', 'ofc'] as const;
export type Confederation = (typeof CONFEDERATIONS)[number];

/** Each confederation's member associations by FIFA trigram, as FIFA lists them. */
const MEMBERS: Record<Confederation, string> = {
  uefa:
    'ALB AND ARM AUT AZE BLR BEL BIH BUL CRO CYP CZE DEN ENG EST FRO FIN FRA GEO GER ' +
    'GIB GRE HUN ISL ISR ITA KAZ KVX LVA LIE LTU LUX MLT MDA MNE NED MKD NIR NOR POL ' +
    'POR IRL ROU RUS SMR SCO SRB SVK SVN ESP SWE SUI TUR UKR WAL',
  afc:
    'AFG AUS BHR BAN BHU BRU CAM CHN TPE GUM HKG IND IDN IRN IRQ JPN JOR PRK KOR KUW ' +
    'KGZ LAO LBN MAC MAS MDV MNG MYA NEP OMA PAK PLE PHI QAT KSA SIN SRI SYR TJK THA ' +
    'TLS TKM UAE UZB VIE YEM',
  caf:
    'ALG ANG BEN BOT BFA BDI CPV CMR CTA CHA COM CGO COD DJI EGY EQG ERI SWZ ETH GAB ' +
    'GAM GHA GUI GNB CIV KEN LES LBR LBY MAD MWI MLI MTN MRI MAR MOZ NAM NIG NGA RWA ' +
    'STP SEN SEY SLE SOM RSA SSD SDN TAN TOG TUN UGA ZAM ZIM',
  concacaf:
    'AIA ATG ARU BAH BRB BLZ BER VGB CAN CAY CRC CUB CUW DMA DOM SLV GRN GUA GUY HAI ' +
    'HON JAM MEX MSR NCA PAN PUR SKN LCA VIN SUR TRI TCA USA VIR',
  conmebol: 'ARG BOL BRA CHI COL ECU PAR PER URU VEN',
  ofc: 'ASA COK FIJ NCL NZL PNG SAM SOL TAH TGA VAN',
};

/** FIFA trigram -> confederation, for every member association. */
export const CONFEDERATION_BY_COUNTRY: Readonly<Record<string, Confederation>> = Object.fromEntries(
  CONFEDERATIONS.flatMap((body) => MEMBERS[body].split(' ').map((code) => [code, body] as const)),
);

/** A country's confederation by its FIFA trigram, case aside; `null` for none or an unknown code. */
export function countryConfederation(code: string | null | undefined): Confederation | null {
  if (code === null || code === undefined) return null;
  return CONFEDERATION_BY_COUNTRY[code.trim().toUpperCase()] ?? null;
}

/**
 * A continental competition's confederation from its clubs: `clubs` counts,
 * per country (FIFA trigram), the clubs of its current season that play in a
 * domestic league of that country this season. The confederation with the
 * most clubs; `null` when no club could be placed or two confederations tie
 * at the top -- never a guess.
 */
export function continentalConfederation(
  clubs: readonly { country_code: string; clubs: number }[],
): Confederation | null {
  const tally = new Map<Confederation, number>();
  for (const row of clubs) {
    const body = countryConfederation(row.country_code);
    if (body === null || !(row.clubs > 0)) continue;
    tally.set(body, (tally.get(body) ?? 0) + row.clubs);
  }
  let best: Confederation | null = null;
  let most = 0;
  let tied = false;
  for (const [body, count] of tally) {
    if (count > most) {
      best = body;
      most = count;
      tied = false;
    } else if (count === most) {
      tied = true;
    }
  }
  return tied ? null : best;
}
