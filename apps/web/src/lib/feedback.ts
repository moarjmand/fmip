/**
 * The testers' feedback place (T-1965, D-466): a link that opens an e-mail
 * to the site's contact mailbox, the subject filled in the reader's language
 * with the page they were on. No form and nothing stored here: the message
 * goes from the reader's own mail program to the mailbox.
 *
 * The address is `SITE_CONTACT_EMAIL`, read on the server at request time
 * (`FeedbackLink` calls `connection()` first, as the demonstration banner
 * does), never written into this public repository. Unset, or not an
 * address, there is no link at all: a link that opens a message to nobody is
 * a dead link (rule 3).
 *
 * No catalogue is imported here: the client half (`FeedbackMailLink`) uses
 * these, and the catalogues stay on the server (T-1040).
 */

/**
 * One address, nothing a `mailto:` would read as a second header or recipient:
 * the local part without spaces or `@ ? & # , ; : < > " ' ( ) = %` (a `%`
 * would let `%2C` or `%0A` add a recipient or a header once a mail program
 * decodes it, RFC 6068), the domain dot-separated labels of letters, digits
 * and hyphens ending in a lettered top-level domain.
 */
const ADDRESS = /^[^\s@?&#,;:<>"'()=%]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;

/**
 * Routes whose next path segment is a key (a `[token]` segment): an invite to
 * a group, a "called it" card. The subject names the route, never the key,
 * as those pages keep it out of a `Referer`; `feedback-link.spec.tsx` holds
 * this list to every `[token]` segment under `app/[locale]`.
 */
export const KEYED_ROUTES: readonly string[] = ['called-it', 'group-invite'];

/** Right-to-left letters: a subject written in them keeps the path left to right. */
const RTL = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/;
/** LEFT-TO-RIGHT MARK, on both sides of the path in a right-to-left subject. */
const LRM = '\u200e';

/** The contact mailbox from the environment, or null when unset or not one address. */
export function siteContactEmail(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env['SITE_CONTACT_EMAIL'] ?? '').trim();
  return ADDRESS.test(raw) ? raw : null;
}

/**
 * The page as the subject names it: its path without the query (a search
 * typed on the page never rides along into a mail) and without a key in the
 * path (`KEYED_ROUTES`: the route's name only).
 */
export function feedbackPage(pathname: string): string {
  const segments = (pathname.split(/[?#]/, 1)[0] ?? '').split('/');
  const keyed = segments.findIndex((segment) => KEYED_ROUTES.includes(segment));
  const kept = keyed === -1 ? segments : segments.slice(0, keyed + 1);
  return kept.join('/') || '/';
}

/**
 * The subject: the reader's language's template with `{page}` replaced by
 * `feedbackPage`. In a right-to-left template the path sits between two
 * left-to-right marks, so "/fa/welcome" is never shown as "fa/welcome/".
 */
export function feedbackSubject(template: string, pathname: string): string {
  const page = feedbackPage(pathname);
  return template.split('{page}').join(RTL.test(template) ? `${LRM}${page}${LRM}` : page);
}

/** `mailto:` the address, with the subject encoded. */
export function feedbackHref(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}
