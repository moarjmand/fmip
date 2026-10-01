import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/messages';
import { stageName } from '@/lib/competition';
import { STAGE_KEYS, stageLabel, type StageKey } from '@/lib/stage-label';

const sayIn =
  (locale: 'en' | 'fa') =>
  (key: StageKey): string =>
    t(locale, key);
const fa = (text: string): string => stageLabel(text, sayIn('fa'), 'fa');
const en = (text: string): string => stageLabel(text, sayIn('en'), 'en');

/** Every form the provider sends that the helper knows (T-1339). */
const KNOWN = [
  'Regular Season',
  'League Stage',
  'Group Stage',
  'Groups',
  'Preliminary Round',
  '1st Qualifying Round',
  '2nd Qualifying Round',
  '3rd Qualifying Round',
  'Play-offs',
  'Knockout Round Play-offs',
  'Round of 32',
  'Round of 16',
  'Quarter-finals',
  'Semi-finals',
  'Final',
  '3rd Place Final',
  'League A',
  'League D',
  'Group A',
  'Group 2',
  'Regular Season - 12',
  'League A - 1',
  'League Stage - 8',
  'Group Stage - 2',
];

describe('stage and round labels (T-1339)', () => {
  it('reads every known form in English exactly as the provider wrote it', () => {
    for (const text of KNOWN) expect(en(text)).toBe(text);
  });

  it('names stages in Persian', () => {
    expect(fa('League A')).toBe('لیگ A');
    expect(fa('Group Stage')).toBe('مرحله‌ی گروهی');
    expect(fa('League Stage')).toBe('مرحله‌ی لیگ');
    expect(fa('Preliminary Round')).toBe('دور مقدماتی');
    expect(fa('Play-offs')).toBe('پلی‌آف');
    expect(fa('Round of 16')).toBe('یک‌هشتم نهایی');
    expect(fa('Quarter-finals')).toBe('یک‌چهارم نهایی');
    expect(fa('Semi-finals')).toBe('نیمه‌نهایی');
    expect(fa('Final')).toBe('فینال');
    expect(fa('Group A')).toBe('گروه A');
  });

  it('writes a round as the matchday, in Persian digits', () => {
    expect(fa('Regular Season - 12')).toBe('هفته‌ی ۱۲');
    expect(fa('League A - 1')).toBe('لیگ A، هفته‌ی ۱');
    expect(fa('Group Stage - 2')).toBe('مرحله‌ی گروهی، هفته‌ی ۲');
    expect(fa('League Stage - 8')).toBe('مرحله‌ی لیگ، هفته‌ی ۸');
    expect(fa('Group 2')).toBe('گروه ۲');
  });

  it('returns what it does not know unchanged, never a guess', () => {
    for (const text of [
      'Semi-finals Qualifying',
      'Relegation Round',
      'Unknown Stage - 3',
      'Regular Season - 03',
      'League AB',
      'Group Stage - ',
      '',
    ]) {
      expect(fa(text)).toBe(text);
      expect(en(text)).toBe(text);
    }
  });

  it('has a Persian text for every key it uses', () => {
    for (const key of STAGE_KEYS) expect(t('fa', key)).not.toBe(t('en', key));
  });

  it('serves server pages through stageName', () => {
    expect(stageName('fa', 'League A - 1')).toBe('لیگ A، هفته‌ی ۱');
    expect(stageName('en', 'League A - 1')).toBe('League A - 1');
  });
});
