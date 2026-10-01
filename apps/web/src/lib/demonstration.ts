import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';

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
 * A page title marked as demonstration data, in the reader's language
 * (T-1309): "Demonstration data — Scores". Prefixed to every page title, so a
 * browser tab and a shared link carry it too. The banner's sentence is
 * `shell.demonstration`, rendered by `DemonstrationBanner`.
 */
export function demonstrationTitle(title: string, locale = 'en'): string {
  return interpolate(t(isLocale(locale) ? locale : DEFAULT_LOCALE, 'shared.demonstration.title'), {
    title,
  });
}

/**
 * The same marking as a Next.js title template, applied by the locale layout.
 *
 * A template reaches **every** page, including the nine that export a plain
 * `metadata` object and never call `pageMetadata` — which is why the `<title>`
 * is done this way round and not in that function.
 */
export function demonstrationTitleTemplate(locale = 'en'): string {
  return demonstrationTitle('%s', locale);
}

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
export function rootTitle(
  title: string,
  locale = 'en',
  demonstration = isDemonstrationData(),
): string {
  return demonstration ? demonstrationTitle(title, locale) : title;
}
