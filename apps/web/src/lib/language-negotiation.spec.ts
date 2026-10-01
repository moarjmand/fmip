import { describe, expect, it } from 'vitest';
import { negotiatedLanguage } from './language-negotiation';

describe('the language a first request is sent to (T-1310)', () => {
  const offered = ['fa'];

  it('sends a Persian browser to Persian, by its language subtag', () => {
    expect(negotiatedLanguage('fa-IR,fa;q=0.9,en-US;q=0.8', offered)).toBe('fa');
    expect(negotiatedLanguage('en-US,en;q=0.9,fa;q=0.8', offered)).toBe('fa');
  });

  it('keeps the quality order and refuses q=0', () => {
    expect(negotiatedLanguage('en;q=0.5,fa;q=0', offered)).toBeNull();
    expect(negotiatedLanguage('de;q=0.9,fa;q=0.95', ['de', 'fa'])).toBe('fa');
  });

  it('answers nothing for no header, a wildcard or a language not offered', () => {
    expect(negotiatedLanguage(null, offered)).toBeNull();
    expect(negotiatedLanguage('', offered)).toBeNull();
    expect(negotiatedLanguage('*', offered)).toBeNull();
    expect(negotiatedLanguage('en-GB,en;q=0.9', offered)).toBeNull();
  });
});
