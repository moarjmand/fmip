/**
 * The testers' feedback place (T-1965, D-465): a link that opens an e-mail
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

/** One address, nothing a `mailto:` would read as a second header or recipient. */
const ADDRESS = /^[^\s@?&#,;:<>"'()]+@[^\s@?&#,;:<>"'()]+\.[^\s@?&#,;:<>"'()]+$/;

/** The contact mailbox from the environment, or null when unset or not one address. */
export function siteContactEmail(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env['SITE_CONTACT_EMAIL'] ?? '').trim();
  return ADDRESS.test(raw) ? raw : null;
}

/**
 * The subject: the reader's language's template with `{page}` replaced by the
 * page's path (without its query, so a search typed on the page never rides
 * along into a mail).
 */
export function feedbackSubject(template: string, pathname: string): string {
  const page = pathname.split(/[?#]/, 1)[0] || '/';
  return template.split('{page}').join(page);
}

/** `mailto:` the address, with the subject encoded. */
export function feedbackHref(address: string, subject: string): string {
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`;
}
