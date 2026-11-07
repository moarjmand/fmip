import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstRunOffer } from './first-run-offer';

/**
 * Home's order and the first run's strip (T-1756, D-373; board P4-2): the
 * main match comes before "Live now", the offer is a 48px strip after the
 * main match (after the "Today" line when there is none), the whole strip
 * is the way in, the close is 44px and named "Not now", and the long
 * sentence has left the strip for the welcome page, which says every step
 * can be skipped.
 */

const HERE = __dirname;
const APP = join(HERE, '..', 'app', '[locale]');
const HOME = readFileSync(join(APP, 'page.tsx'), 'utf8');
const WELCOME = readFileSync(join(APP, 'welcome', 'page.tsx'), 'utf8');
const EN = JSON.parse(readFileSync(join(HERE, '..', 'i18n', 'catalogues', 'en.json'), 'utf8'));

const tag = (html: string, testId: string) =>
  new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`).exec(html)?.[0] ?? '';

describe('home’s order (D-373)', () => {
  const at = (needle: string) => {
    const i = HOME.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };

  it('puts the main match first, then the strip, then "Live now"', () => {
    expect(at('<HomeDateline')).toBeLessThan(at('{hero !== null && ('));
    expect(at('{hero !== null && (')).toBeLessThan(at('<BigMatch'));
    expect(at('<BigMatch')).toBeLessThan(
      at('{offerFirstRun && <FirstRunOffer locale={locale} />}'),
    );
    expect(at('{offerFirstRun && <FirstRunOffer')).toBeLessThan(at('<LiveNow'));
    expect(at('<LiveNow')).toBeLessThan(at('<UpsetCard answer={upsetAnswer} placement="main"'));
  });

  it('with no main match, puts the strip first in the column, right after the "Today" line', () => {
    // The only things between the dateline and the strip are the column's
    // opening and the hero, drawn only when there is one.
    const between = HOME.slice(at('<HomeDateline'), at('{offerFirstRun && <FirstRunOffer'));
    expect(between.match(/<[A-Z][A-Za-z]+/g)).toEqual(['<HomeDateline', '<BigMatch']);
  });

  it('offers it nowhere else on the page', () => {
    expect(HOME.match(/<FirstRunOffer/g)).toHaveLength(1);
  });
});

describe('the first run’s strip (D-373)', () => {
  const html = renderToStaticMarkup(<FirstRunOffer locale="en" />);

  it('is one 48px strip whose whole body is the way in', () => {
    expect(tag(html, 'first-run-offer')).toMatch(/^<aside[^>]*class="[^"]*\bmin-h-12\b/);
    expect(tag(html, 'first-run-offer')).toContain('aria-labelledby="first-run-offer"');
    const start = tag(html, 'first-run-start');
    expect(start).toMatch(/^<a /);
    expect(start).toContain('href="/en/welcome"');
    expect(start).toMatch(/\bflex-1\b/);
    expect(start).toMatch(/\bmin-h-11\b/);
    expect(html).toContain('Make Stadiomind yours');
  });

  it('closes with a 44px button named "Not now", a plain form with no script', () => {
    const close = tag(html, 'first-run-dismiss');
    expect(close).toMatch(/^<button /);
    expect(close).toContain('type="submit"');
    expect(close).toContain('aria-label="Not now"');
    expect(close).toMatch(/\bsize-11\b/);
    expect(html).toMatch(/<form [^>]*action=/);
    const source = readFileSync(join(HERE, 'first-run-offer.tsx'), 'utf8');
    expect(source).not.toMatch(/^'use client'/);
    expect(source).toContain('dismissFirstRunAction.bind(null, locale)');
  });

  it('says one line: the long sentence has left it', () => {
    expect(html).not.toMatch(/can be skipped|choose a language/i);
    expect(EN['firstRun.offer.text']).toBeUndefined();
  });

  it('leaves "every step can be skipped" to the welcome page, which says it and offers it', () => {
    expect(EN['firstRun.intro']).toMatch(/each one skippable/);
    expect(WELCOME).toContain('message="firstRun.intro"');
    expect(WELCOME).toContain('data-testid="first-run-skip"');
  });

  it('speaks Persian on /fa, the close named «حالا نه»', () => {
    const fa = renderToStaticMarkup(<FirstRunOffer locale="fa" />);
    expect(tag(fa, 'first-run-dismiss')).toContain('aria-label="حالا نه"');
    expect(tag(fa, 'first-run-dismiss')).not.toContain('lang="en"');
    expect(fa).toContain('Stadiomind را به سلیقه‌ی خودتان تنظیم کنید');
    expect(tag(fa, 'first-run-start')).toContain('href="/fa/welcome"');
  });

  it('is neutral and laid out by logical sides only (rules 6 and 7)', () => {
    expect(html).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-[\w[]/);
    expect(html).not.toMatch(/text-model|bg-model/);
  });
});
