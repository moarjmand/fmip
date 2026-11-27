import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE, PRIVACY_PATH, privacyController } from './privacy-notice';

/**
 * Who the privacy notice names (T-1969, D-465): the controller and his
 * mailbox from the server's environment, or no notice at all; and nothing
 * personal in this public repository -- the catalogues carry `{controller}`
 * and `{email}`, `.env.example` carries empty variables.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const CATALOGUES = join(__dirname, '..', 'i18n', 'catalogues');
const VARIABLES = [
  'PRIVACY_CONTROLLER_NAME',
  'SITE_CONTACT_EMAIL',
  'PRIVACY_POSTAL_ADDRESS',
  'PRIVACY_ICO_NUMBER',
] as const;

/** Every catalogue's privacy words: the English, and each locale's source and text. */
function privacyTexts(): { file: string; key: string; text: string }[] {
  const found: { file: string; key: string; text: string }[] = [];
  for (const file of readdirSync(CATALOGUES).filter((name) => name.endsWith('.json'))) {
    const catalogue = JSON.parse(readFileSync(join(CATALOGUES, file), 'utf8')) as Record<
      string,
      string | { source?: string; text?: string }
    >;
    for (const [key, entry] of Object.entries(catalogue)) {
      if (!key.startsWith('privacy.') && !key.startsWith('auth.register.privacy')) continue;
      const texts = typeof entry === 'string' ? [entry] : [entry.source ?? '', entry.text ?? ''];
      for (const text of texts) found.push({ file, key, text });
    }
  }
  return found;
}

describe('who the notice names', () => {
  const env = {
    PRIVACY_CONTROLLER_NAME: '  A. Controller ',
    SITE_CONTACT_EMAIL: ' privacy@example.test ',
  };

  it('is the controller and his mailbox, trimmed; the optional lines absent', () => {
    expect(privacyController(env)).toEqual({
      name: 'A. Controller',
      email: 'privacy@example.test',
      postalAddress: null,
      icoNumber: null,
    });
  });

  it('carries the postal address and the ICO number when they are set', () => {
    expect(
      privacyController({
        ...env,
        PRIVACY_POSTAL_ADDRESS: 'PO Box 1, Testtown',
        PRIVACY_ICO_NUMBER: 'ZA000000',
      }),
    ).toMatchObject({ postalAddress: 'PO Box 1, Testtown', icoNumber: 'ZA000000' });
  });

  it.each([
    ['nothing set', {}],
    ['no mailbox', { PRIVACY_CONTROLLER_NAME: 'A. Controller' }],
    ['no controller', { SITE_CONTACT_EMAIL: 'privacy@example.test' }],
    ['blank values', { PRIVACY_CONTROLLER_NAME: ' ', SITE_CONTACT_EMAIL: '' }],
    ['a mailbox that is not an address', { ...env, SITE_CONTACT_EMAIL: 'privacy at example' }],
    ['two addresses', { ...env, SITE_CONTACT_EMAIL: 'a@example.test b@example.test' }],
    [
      'an address carrying a query',
      { ...env, SITE_CONTACT_EMAIL: 'a@example.com?cc=b@example.com' },
    ],
    ['a top-level name that is not letters', { ...env, SITE_CONTACT_EMAIL: 'a@example.c0m' }],
  ])('is nobody with %s: the page says it is being prepared', (_, given) => {
    expect(privacyController(given)).toBeNull();
  });

  it('is at /privacy under each locale', () => {
    expect(PRIVACY_PATH).toBe('/privacy');
  });

  it('names a text that is a draft until the approved one is brought in', () => {
    // Whoever brings in the approved text sets the date in the same change
    // (T-1953); until then the page says "draft, not in effect".
    expect(PRIVACY_NOTICE).toEqual({ version: '0.4', effective: null });
  });

  it('has no open value left once the text has an effective date', () => {
    // The approved text writes in every value the draft left open; a notice
    // in force never says "not yet confirmed" (review of PR #977).
    const open = privacyTexts().filter((entry) => entry.text.includes('{pending}'));
    if (PRIVACY_NOTICE.effective === null) expect(open.length).toBeGreaterThan(0);
    else expect(open.map((entry) => `${entry.file} ${entry.key}`)).toEqual([]);
  });
});

describe('nothing personal in the repository (D-465)', () => {
  const texts = privacyTexts();

  it('reads the privacy words of all nine catalogues', () => {
    expect(new Set(texts.map((entry) => entry.file)).size).toBeGreaterThanOrEqual(9);
    expect(texts.length).toBeGreaterThan(200);
  });

  it('holds no e-mail address and no ICO number: the controller and his mailbox are placeholders', () => {
    for (const { file, key, text } of texts) {
      expect(text, `${file} ${key}`).not.toMatch(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
      // ICO registration numbers: Z or ZA/ZB followed by digits.
      expect(text, `${file} ${key}`).not.toMatch(/\bZ[A-Z]?\d{6,7}\b/);
    }
  });

  it('names the controller and the mailbox by placeholder, in English and Persian', () => {
    const en = JSON.parse(readFileSync(join(CATALOGUES, 'en.json'), 'utf8')) as Record<
      string,
      string
    >;
    const fa = JSON.parse(readFileSync(join(CATALOGUES, 'fa.json'), 'utf8')) as Record<
      string,
      { text: string; status: string }
    >;
    for (const text of [en['privacy.who.body'], fa['privacy.who.body']?.text]) {
      expect(text?.match(/\{controller\}/g)).toHaveLength(2);
    }
    for (const key of ['privacy.who.contact', 'privacy.complain.body', 'privacy.rights.access']) {
      expect(en[key], key).toContain('{email}');
      expect(fa[key]?.text, key).toContain('{email}');
    }
    expect(en['privacy.who.postal']).toContain('{address}');
    expect(en['privacy.who.ico']).toContain('{ico}');
  });

  it('leaves the four variables empty in .env.example, for the server’s .env to fill', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    for (const name of VARIABLES) {
      expect(example, name).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });

  it('passes them to the web container with no value of its own', () => {
    const compose = readFileSync(join(ROOT, 'deploy', 'docker-compose.prod.yml'), 'utf8');
    for (const name of VARIABLES) {
      expect(compose, name).toContain(`${name}: \${${name}:-}`);
    }
  });
});
