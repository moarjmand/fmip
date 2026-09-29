import { describe, expect, it } from 'vitest';
import { rulesBlocks, rulesVersionNumber } from './platform-rules';

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
