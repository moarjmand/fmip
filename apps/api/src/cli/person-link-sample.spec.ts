import { describe, expect, it } from 'vitest';
import { personLinksOn } from '../modules/news/news-clustering.service';
import { DEFAULT_SIZE, MAX_SIZE, parseSampleArgs, sheetRow } from './person-link-sample';

/** T-1006: the precision sample's arguments and sheet, and the switch it gates. */
describe('the person-link sample', () => {
  it('takes a size, and refuses anything else', () => {
    expect(parseSampleArgs([])).toEqual({ size: DEFAULT_SIZE });
    expect(parseSampleArgs(['--size', '120'])).toEqual({ size: 120 });
    expect(parseSampleArgs(['--size', '0'])).toHaveProperty('error');
    expect(parseSampleArgs(['--size', String(MAX_SIZE + 1)])).toHaveProperty('error');
    expect(parseSampleArgs(['--size', 'many'])).toHaveProperty('error');
    expect(parseSampleArgs(['--write'])).toHaveProperty('error');
  });

  it('keeps one link on one line, whatever the publisher wrote', () => {
    expect(sheetRow(['a', 'Line\none\tand two', null])).toBe('a\tLine one and two\t');
  });

  it('links persons only when the operator says on', () => {
    expect(personLinksOn({})).toBe(false);
    expect(personLinksOn({ NEWS_PERSON_LINKS: 'off' })).toBe(false);
    expect(personLinksOn({ NEWS_PERSON_LINKS: 'yes' })).toBe(false);
    expect(personLinksOn({ NEWS_PERSON_LINKS: ' On ' })).toBe(true);
  });
});
