/**
 * The privacy notice (T-1969, D-465): who it names, which text it is, and
 * whether it can be shown at all.
 *
 * **Who it names comes from the server, never from this repository.** The
 * controller is an individual (T-1953): his name, the contact mailbox he
 * reads, a postal address and an ICO registration number are personal data,
 * and this repository is public. The catalogues hold the notice's words with
 * `{controller}` and `{email}` where those go; the values are read here, at
 * request time, from the web server's environment, which only the maintainer
 * fills (`.env` on the server).
 *
 * **Without a controller and a mailbox there is no notice.** A notice that
 * cannot say who decides about the data, or how to reach him, is not one
 * (UK GDPR art. 13(1)(a)); `/privacy` then says the notice is being
 * prepared, and neither the footer nor the sign-up form links to it (rule
 * 3: never a link to a page that only looks finished). The postal address
 * and the ICO number are optional: their lines appear only when set.
 *
 * Read from `process.env` at request time, after `connection()` (the
 * callers', as in `DemonstrationBanner`): the variables reach the container
 * at runtime, and a value read while Next.js prerendered would be the
 * build's, which is none.
 */

/** The notice's path under each locale. */
export const PRIVACY_PATH = '/privacy';

/** Who the notice names, from the server's environment. */
export interface PrivacyController {
  /** `PRIVACY_CONTROLLER_NAME`: the controller, as on his passport. */
  name: string;
  /** `SITE_CONTACT_EMAIL`: the mailbox the controller reads. */
  email: string;
  /** `PRIVACY_POSTAL_ADDRESS`: shown only when set. */
  postalAddress: string | null;
  /** `PRIVACY_ICO_NUMBER`: shown only when set. */
  icoNumber: string | null;
}

/** One address, nothing around it: no space, one `@`, a dot in the domain. */
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>".]+$/;

/** A value, trimmed; empty or absent is null. */
function value(env: Record<string, string | undefined>, name: string): string | null {
  const raw = env[name]?.trim();
  return raw === undefined || raw === '' ? null : raw;
}

/**
 * The controller and how to reach him, or null when the notice cannot be
 * shown: the name or the mailbox unset, or the mailbox not an address (a
 * typo is not a contact; the page then says the notice is being prepared,
 * which is what the maintainer sees and corrects).
 */
export function privacyController(
  env: Record<string, string | undefined> = process.env,
): PrivacyController | null {
  const name = value(env, 'PRIVACY_CONTROLLER_NAME');
  const email = value(env, 'SITE_CONTACT_EMAIL');
  if (name === null || email === null || !EMAIL.test(email)) return null;
  return {
    name,
    email,
    postalAddress: value(env, 'PRIVACY_POSTAL_ADDRESS'),
    icoNumber: value(env, 'PRIVACY_ICO_NUMBER'),
  };
}

/**
 * The text in the catalogues (`privacy.*`): the business adviser's draft
 * 0.4 of 2026-11-27 (T-1953), its notes for the lawyer left out. **Not
 * approved yet**: `effective` is null until the maintainer approves the text
 * after a lawyer has read it, and until then the page says it is a draft and
 * not in effect. Whoever brings in the approved text sets both, in the same
 * change as its words.
 */
export const PRIVACY_NOTICE: { version: string; effective: string | null } = {
  version: '0.4',
  effective: null,
};
