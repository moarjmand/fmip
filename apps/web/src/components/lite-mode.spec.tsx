import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityMedia, NewsImage } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveMessages } from '@/i18n/messages';
import { LITE_BANNER_KEYS, type LitePreference } from '@/lib/lite';
import { EntityImage } from './entity-image';
import { LiteBanner, LiteFootnote, LiteOffSwitch } from './lite-banner';
import { LiteProvider } from './lite-mode';
import { LiteSetting } from './lite-setting';
import { NewsCardImage, NewsPhoto, NewsThumb } from './news-image';

/**
 * Lite mode in the page (T-1387, D-205): no `<img>` at all when it is on,
 * the lettered mark in a crest's place; the banner under the header with its
 * reason and its switch; the footnote; Settings' Auto / On / Off; and the
 * fonts switched to the device's on <html> before any face is requested.
 */

const HERE = __dirname;
const LAYOUT = readFileSync(join(HERE, '..', 'app', '[locale]', 'layout.tsx'), 'utf8');
const GLOBALS = readFileSync(join(HERE, '..', 'app', 'globals.css'), 'utf8');
const SETTINGS = readFileSync(join(HERE, '..', 'app', '[locale]', 'settings', 'page.tsx'), 'utf8');

const CREST: EntityMedia = { coverage: 'available', url: '/api/media/crest/t-1/0123456789ab' };
const PHOTO: NewsImage = {
  url: '/media/news/0b6f9c1e-3a52-4e0c-9d7a-1f2e3d4c5b6a.jpg',
  credit: 'Mehr News Agency',
  licence: 'cc-by-4.0',
  licence_url: 'https://creativecommons.org/licenses/by/4.0/',
  width: 1200,
  height: 800,
};
const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function within(preference: LitePreference, slow: boolean, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <LiteProvider preference={preference} slow={slow}>
      {node}
    </LiteProvider>,
  );
}

const IMAGES = (
  <>
    <EntityImage media={CREST} kind="crest" name="Manchester United" size={22} />
    <EntityImage media={CREST} kind="photo" name="Mohamed Salah" size={96} decorative={false} />
    <NewsPhoto image={PHOTO} headline="Headline" locale="en" />
    <NewsCardImage image={PHOTO} />
    <NewsThumb image={PHOTO} />
  </>
);

describe('images in lite mode', () => {
  it.each([
    ['chosen', 'on', false],
    ['auto on a slow connection', 'auto', true],
  ] as const)('render no <img> at all when %s', (_label, preference, slow) => {
    const out = within(preference, slow, IMAGES);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('/api/media/');
    expect(out).not.toContain('/media/news/');
    // Nor the credit of a photo that is not there.
    expect(out).not.toContain('Mehr News Agency');
  });

  it('keep the lettered mark where a crest was, saying the image exists and was left out', () => {
    const out = within('on', false, IMAGES);
    expect(out).toContain('data-letters="MU"');
    expect(out).toContain('data-letters="MS"');
    expect(out).toContain('data-omitted="lite"');
    expect(out).toContain('data-coverage="available"');
    expect(out).not.toContain('data-coverage="not_supplied"');
    // Alone, the mark still names the player for assistive technology.
    expect(out).toContain('role="img" aria-label="Mohamed Salah"');
  });

  it.each([
    ['off', 'off', true],
    ['auto on a connection nobody called slow', 'auto', false],
  ] as const)('are drawn as before when lite mode is %s', (_label, preference, slow) => {
    const out = within(preference, slow, IMAGES);
    expect(out.match(/<img /g)).toHaveLength(5);
    expect(out).not.toContain('data-omitted');
  });

  it('are drawn outside any provider (an error page, a spec): lite mode is off by default', () => {
    expect(renderToStaticMarkup(IMAGES).match(/<img /g)).toHaveLength(5);
  });
});

describe('the lite banner', () => {
  const en = resolveMessages('en', LITE_BANNER_KEYS);
  const fa = resolveMessages('fa', LITE_BANNER_KEYS);

  it('says a slow connection was detected when auto turned it on', () => {
    const out = within('auto', true, <LiteBanner words={en} />);
    expect(out).toContain('Lite mode on · slow connection detected');
    expect(out).toContain('data-reason="slow"');
    expect(out).toContain('role="status"');
  });

  it('says plainly "Lite mode on" when the reader chose it', () => {
    const out = within('on', true, <LiteBanner words={en} />);
    expect(out).toContain('>Lite mode on<');
    expect(out).not.toContain('slow connection');
    expect(out).toContain('data-reason="chosen"');
  });

  it('is in Persian on /fa, in the board’s words', () => {
    expect(within('auto', true, <LiteBanner words={fa} />)).toContain(
      'حالت سبک فعال است · اینترنت کند تشخیص داده شد',
    );
    expect(within('on', false, <LiteFootnote words={fa} />)).toContain(
      'بدون تصویر و نشان باشگاه · فقط فونت‌های دستگاه',
    );
  });

  it('and the footnote are not drawn at all when lite mode is off', () => {
    expect(within('off', true, <LiteBanner words={en} />)).toBe('');
    expect(within('auto', false, <LiteFootnote words={en} />)).toBe('');
    expect(within('on', false, <LiteFootnote words={en} />)).toContain(
      'No images or club crests · device fonts only',
    );
  });

  it('is a thin strip, not a modal, laid out with logical properties only', () => {
    const out = within('on', false, <LiteBanner words={en} />);
    expect(out).not.toMatch(/role="dialog"|aria-modal|fixed/);
    expect(out).not.toMatch(PHYSICAL);
  });
});

describe('the lite switch', () => {
  const label = resolveMessages('en', LITE_BANNER_KEYS)['lite.switch'];
  const out = renderToStaticMarkup(<LiteOffSwitch label={label} />);

  it('is a named switch, on, that posts lite=off', () => {
    expect(out).toMatch(/^<button /);
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain('aria-label="Lite mode"');
    expect(out).toContain('type="submit"');
    expect(out).toContain('name="lite"');
    expect(out).toContain('value="off"');
  });

  it('is a 44px-tall, 52px-wide touch target whose track is decoration', () => {
    expect(out).toContain('h-11');
    expect(out).toContain('w-13');
    expect(out).toContain('aria-hidden="true"');
  });

  it('puts its knob at the inline end when on, so it mirrors under RTL', () => {
    expect(out).toContain('end-0.75');
    expect(out).not.toMatch(PHYSICAL);
  });

  it('marks an untranslated label as English', () => {
    const es = resolveMessages('es', LITE_BANNER_KEYS)['lite.switch'];
    expect(renderToStaticMarkup(<LiteOffSwitch label={es} />)).toContain('lang="en"');
  });
});

describe('Settings -> Appearance -> Lite mode', () => {
  it('offers Auto, On and Off as one form, the current one pressed', () => {
    const out = renderToStaticMarkup(<LiteSetting locale="en" current="auto" />);
    expect(out).toContain('role="group"');
    for (const [value, word] of [
      ['auto', 'Auto'],
      ['on', 'On'],
      ['off', 'Off'],
    ]) {
      expect(out).toMatch(new RegExp(`value="${value}"[^>]*name="lite"[^>]*>${word}<`));
    }
    expect(out).toMatch(/aria-pressed="true"[^>]*data-testid="appearance-lite-auto"/);
    expect(out).toMatch(/aria-pressed="false"[^>]*data-testid="appearance-lite-off"/);
    expect(SETTINGS).toContain('<LiteSetting locale={locale} current={lite.preference} />');
  });
});

describe('the page in lite mode', () => {
  it('is rendered lite by the server, on <html>, inside the provider', () => {
    expect(LAYOUT).toContain("data-lite={lite.on ? 'on' : 'off'}");
    expect(LAYOUT).toContain('<LiteProvider preference={lite.preference} slow={lite.slow}>');
    expect(LAYOUT).toContain('banner={<LiteBanner words={liteWords} />}');
  });

  it('names no web font in any role, so no woff2 is requested', () => {
    const block = /html:root\[data-lite='on'\] \{([^}]*)\}/.exec(GLOBALS)?.[1] ?? '';
    for (const role of ['sans', 'latin', 'serif', 'naskh', 'mono']) {
      expect(block, role).toContain(`--font-${role}:`);
    }
    expect(block).not.toMatch(/Variable'/);
    expect(GLOBALS).toContain("@custom-variant lite (&:where([data-lite='on'] *));");
  });
});
