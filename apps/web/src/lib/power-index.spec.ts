import { describe, expect, it } from 'vitest';
import type { PowerIndex, PowerIndexComponentValue } from '@fmip/contracts';
import {
  barWidth,
  completenessSentence,
  componentSentence,
  leadingSentence,
  listed,
} from './power-index';

// The words the Power Index panel puts on screen (T-114). The blueprint asks
// the public display to explain the leading factors and the data completeness;
// a decimal does neither, so the sentences are here and are tested.

function component(over: Partial<PowerIndexComponentValue> = {}): PowerIndexComponentValue {
  return {
    key: 'underlying_strength',
    weight: 0.35,
    value: 0.62,
    state: 'available',
    note: null,
    ...over,
  };
}

function index(over: Partial<PowerIndex> = {}): PowerIndex {
  return {
    team: { id: 'a', name: 'Team' },
    value: 62,
    completeness: 0.7,
    formula_version: 'power-index@1.0.0',
    computed_at: '2026-01-05T18:00:00.000Z',
    components: [
      component(),
      component({ key: 'lineup_quality', weight: 0.2, value: null, state: 'not_supplied' }),
      component({ key: 'stability', weight: 0.05, value: null, state: 'not_supplied' }),
    ],
    leading: ['underlying_strength'],
    ...over,
  };
}

describe('a component as a sentence', () => {
  it('says where the team stands, not what the decimal is', () => {
    expect(componentSentence(component({ value: 0.62 }))).toBe('Ahead of 62% of this competition');
    expect(componentSentence(component({ value: 0.95 }))).toBe('Top 10% of this competition');
    expect(componentSentence(component({ value: 0.04 }))).toBe('Bottom 10% of this competition');
  });

  it('says a missing component is missing', () => {
    expect(componentSentence(component({ value: null, state: 'not_supplied' }))).toBe(
      'Not available',
    );
  });

  it('gives a missing component no bar at all, rather than a bar of width zero', () => {
    // A zero-width bar reads as "measured, and it is bad" — the opposite of
    // "nobody measured this" (rule 3).
    expect(barWidth(component({ value: null, state: 'not_supplied' }))).toBeNull();
    expect(barWidth(component({ value: 0.5 }))).toBe('50%');
  });
});

describe('the completeness sentence', () => {
  it('names what was left out, not just the percentage', () => {
    const sentence = completenessSentence(index());
    expect(sentence).toContain('70% of the index was measurable');
    expect(sentence).toContain('expected or confirmed line-up quality');
    expect(sentence).toContain('managerial and team stability');
  });

  it('says so plainly when nothing was missing', () => {
    const complete = index({ completeness: 1, components: [component()] });
    expect(completenessSentence(complete)).toBe('Every component was measured.');
  });
});

describe('the leading factors', () => {
  it('names them in a sentence', () => {
    expect(leadingSentence(index())).toBe('Driven mostly by underlying team strength.');
    expect(leadingSentence(index({ leading: ['underlying_strength', 'venue'] }))).toBe(
      'Driven mostly by underlying team strength and venue effect.',
    );
  });

  it('stays silent when nothing led, rather than inventing a reason', () => {
    expect(leadingSentence(index({ leading: [] }))).toBeNull();
  });

  it('lists two with "and", three with commas', () => {
    expect(listed(['a'])).toBe('a');
    expect(listed(['a', 'b'])).toBe('a and b');
    expect(listed(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listed([])).toBe('');
  });
});
