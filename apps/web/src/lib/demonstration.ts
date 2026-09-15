/**
 * Whether the football data in this deployment is demonstration data (T-087).
 *
 * **The problem this exists for.** The public preview runs the whole product
 * against a database loaded with development fixtures: matches that were never
 * played, scores that never happened, members who do not exist. On a public
 * address, unmarked, that is rule 3 — inventing a value — told to everybody who
 * opens the link, and to every crawler that follows it.
 *
 * **Why this is its own variable and not `PREVIEW_SEED`.** `PREVIEW_SEED=on`
 * means "load fixtures at boot". It is an instruction, and it is spent the
 * moment it runs: turn it off afterwards and the fixtures are still in the
 * database. A marker keyed on it would disappear while the thing it marks
 * stayed, which is the failure it was there to prevent. `DEMONSTRATION_DATA` is
 * a statement about what the database holds, and it stays true as long as that
 * is true.
 *
 * The two are tied in the direction that matters: `deploy/preview/start.mjs`
 * refuses to seed unless this is `on`. Marking without seeding is harmless;
 * seeding without marking is the thing that must not be possible.
 *
 * Read from the environment at request time — never inlined at build time.
 * `DemonstrationBanner` is where that is enforced, and it explains how.
 */
export function isDemonstrationData(
  env: Record<string, string | undefined> = process.env,
): boolean {
  // `on`, and nothing else. An absent variable is a normal deployment; a
  // misspelled one is a normal deployment too, which is the safe way round:
  // the failure mode of a typo is a missing banner on a preview, not a banner
  // on production claiming real football is invented.
  return (env['DEMONSTRATION_DATA'] ?? '').trim().toLowerCase() === 'on';
}

/**
 * What the banner and the page title say. One sentence, four nouns, no hedging:
 * a reader who meets a score here should not have to work out whether it
 * happened.
 */
export const DEMONSTRATION_NOTICE =
  'Demonstration data. Every match, score, team and member on this site is development fixture data. None of it is real football, and nothing here has happened.';

/** Prefixed to every page title, so a browser tab and a shared link carry it too. */
export const DEMONSTRATION_TITLE_PREFIX = 'Demonstration data — ';

/**
 * The same prefix as a Next.js title template, applied by the locale layout.
 *
 * A template reaches **every** page, including the nine that export a plain
 * `metadata` object and never call `pageMetadata` — which is why the `<title>`
 * is done this way round and not in that function.
 */
export const DEMONSTRATION_TITLE_TEMPLATE = `${DEMONSTRATION_TITLE_PREFIX}%s`;

/**
 * The one page the template cannot reach.
 *
 * Next.js applies `title.template` to **child route segments**, and
 * `[locale]/page.tsx` is not one: it sits in the same segment as
 * `[locale]/layout.tsx`, which is where the template is defined. So the locale
 * root rendered `FMIP` with no marker on it while every page below it carried
 * one -- found on the public deployment, which is the only place it shows.
 *
 * This is a complete fix rather than a patch over one case: a segment holds at
 * most one `page.tsx`, so there is exactly one page this can ever apply to, and
 * `demonstration.spec.ts` asserts it is the one calling this.
 */
export function rootTitle(title: string, demonstration = isDemonstrationData()): string {
  return demonstration ? `${DEMONSTRATION_TITLE_PREFIX}${title}` : title;
}
