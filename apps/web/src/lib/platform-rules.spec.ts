import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type RulesBlock, rulesBlocks, rulesSections, rulesVersionNumber } from './platform-rules';

/** The text of 1.0.0 as the migration stores it, so the sections are checked against it. */
const V1 = /\$rules\$([\s\S]*?)\$rules\$/.exec(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'db',
      'migrations',
      '1765300000000_platform-rules-version.sql',
    ),
    'utf8',
  ),
)![1]!;

describe('rulesBlocks', () => {
  it('reads paragraphs and lists, and nothing else as markup', () => {
    const body = [
      'Joining. You need an e-mail address',
      'you can receive mail at.',
      '',
      '- Spam. Repeated unwanted messages.',
      '- Abuse. <b>Harassment</b>.',
      '',
      '',
      'Changes. You are asked.',
    ].join('\r\n');

    expect(rulesBlocks(body)).toEqual([
      { kind: 'paragraph', text: 'Joining. You need an e-mail address you can receive mail at.' },
      { kind: 'list', items: ['Spam. Repeated unwanted messages.', 'Abuse. <b>Harassment</b>.'] },
      { kind: 'paragraph', text: 'Changes. You are asked.' },
    ]);
  });

  it('keeps a paragraph that only begins with a dash a paragraph', () => {
    expect(rulesBlocks('- one\nnot a list item')).toEqual([
      { kind: 'paragraph', text: '- one not a list item' },
    ]);
  });
});

describe('rulesVersionNumber', () => {
  it('shows the number of a version', () => {
    expect(rulesVersionNumber('platform-rules@1.1.0')).toBe('1.1.0');
    expect(rulesVersionNumber('odd')).toBe('odd');
  });
});

describe('rulesSections (T-1789, D-410)', () => {
  const sections = rulesSections('platform-rules@1.0.0', V1)!;

  it('gives 1.0.0 the eight sections its own lead-ins name, with an anchor each', () => {
    expect(sections.map((section) => [section.id, section.heading])).toEqual([
      ['joining', 'Joining'],
      ['what-this-place-is-for', 'What this place is for'],
      ['what-is-not-allowed', 'What is not allowed'],
      ['your-rating-is-earned-and-is-shown', 'Your rating is earned and is shown'],
      ['reports-and-decisions', 'Reports and decisions'],
      ['appeals', 'Appeals'],
      ['leaving', 'Leaving'],
      ['changes', 'Changes'],
    ]);
  });

  it('changes no word of the accepted text: each heading and its blocks are the stored blocks', () => {
    const again: RulesBlock[] = sections.flatMap((section) => {
      const [first, ...rest] = section.blocks;
      const lead = `${section.heading}.`;
      return first?.kind === 'paragraph'
        ? [{ kind: 'paragraph' as const, text: `${lead} ${first.text}` }, ...rest]
        : [{ kind: 'paragraph' as const, text: lead }, ...section.blocks];
    });
    expect(again).toEqual(rulesBlocks(V1));
  });

  it('keeps the blocks without a lead-in in the section before them', () => {
    const leaving = sections.find((section) => section.id === 'leaving')!;
    expect(leaving.blocks.map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph']);
    expect(leaving.blocks[2]).toEqual({
      kind: 'paragraph',
      text: 'The deletion is recorded (who asked and when), without a copy of what was removed.',
    });
    const notAllowed = sections.find((section) => section.id === 'what-is-not-allowed')!;
    expect(notAllowed.blocks.map((block) => block.kind)).toEqual(['list']);
  });

  it('leaves a version nobody has checked as plain blocks', () => {
    expect(rulesSections('platform-rules@1.1.0', V1)).toBeNull();
  });

  it('gives up rather than guess when the text does not open on a lead-in', () => {
    expect(
      rulesSections(
        'platform-rules@1.0.0',
        'The deletion is recorded (who asked).\n\nJoining. You.',
      ),
    ).toBeNull();
  });
});
