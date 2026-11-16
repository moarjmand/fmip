import {
  CONSOLE_CANVAS_NOTE_MAX,
  CONSOLE_CANVAS_SOURCE_MAX,
  CONSOLE_CANVAS_TEXT_MAX,
} from '@fmip/contracts/console';
import { describe, expect, it } from 'vitest';
import {
  type CardState,
  changedReason,
  changesOf,
  checkCardPatch,
  checkMove,
  checkNewCard,
  hasText,
  nextPosition,
  reordered,
} from './canvas-rules';

/** T-1855 (D-440): what a person may write to the business model canvas. */

const CARD: CardState = {
  block: 'channels',
  tag: 'assumption',
  text_fa: 'کانال تلگرام',
  text_en: 'The Telegram channel',
  note_fa: '',
  note_en: '',
  source: 'D-427',
};

describe('checkNewCard', () => {
  it('takes a block and a text in one language, trimmed; the tag is an assumption unless said', () => {
    expect(checkNewCard({ block: 'channels', text_fa: '  کانال تلگرام  ' })).toEqual({
      ok: true,
      value: {
        block: 'channels',
        tag: 'assumption',
        text_fa: 'کانال تلگرام',
        text_en: '',
        note_fa: '',
        note_en: '',
        source: '',
      },
    });
    expect(
      checkNewCard({
        block: 'revenue_streams',
        tag: 'question',
        text_en: 'Ads?',
        note_en: 'Not yet',
      }),
    ).toMatchObject({ ok: true, value: { tag: 'question', text_en: 'Ads?', note_en: 'Not yet' } });
  });

  it('keeps line breaks inside a text', () => {
    const checked = checkNewCard({ block: 'channels', text_en: 'one\ntwo' });
    expect(checked).toMatchObject({ ok: true, value: { text_en: 'one\ntwo' } });
  });

  it('refuses no text in either language, an unknown block or tag, and too long a field', () => {
    expect(checkNewCard({ block: 'channels', text_fa: '  ', text_en: '' })).toEqual({
      ok: false,
      reason: 'A card needs its text in Persian or English.',
    });
    expect(checkNewCard({ block: 'kp', text_en: 'x' }).ok).toBe(false);
    expect(checkNewCard({ block: 'channels', tag: 'maybe', text_en: 'x' }).ok).toBe(false);
    expect(
      checkNewCard({ block: 'channels', text_en: 'x'.repeat(CONSOLE_CANVAS_TEXT_MAX + 1) }),
    ).toEqual({ ok: false, reason: "A card's English text is at most 500 characters." });
    expect(
      checkNewCard({
        block: 'channels',
        text_en: 'x',
        note_fa: 'x'.repeat(CONSOLE_CANVAS_NOTE_MAX + 1),
      }).ok,
    ).toBe(false);
    expect(
      checkNewCard({
        block: 'channels',
        text_en: 'x',
        source: 'x'.repeat(CONSOLE_CANVAS_SOURCE_MAX + 1),
      }).ok,
    ).toBe(false);
    expect(checkNewCard({ block: 'channels', text_en: 42 }).ok).toBe(false);
    expect(checkNewCard('x').ok).toBe(false);
  });
});

describe('checkCardPatch', () => {
  it('takes any of the fields, and an emptied text or note', () => {
    expect(checkCardPatch({ tag: 'risk' })).toEqual({ ok: true, value: { tag: 'risk' } });
    expect(checkCardPatch({ block: 'key_partners', note_fa: null, text_en: '  ' })).toEqual({
      ok: true,
      value: { block: 'key_partners', note_fa: '', text_en: '' },
    });
  });

  it('refuses nothing to change, an unknown block or tag, and an unknown shape', () => {
    expect(checkCardPatch({})).toEqual({ ok: false, reason: 'Nothing to change.' });
    expect(checkCardPatch({ title: 'x' }).ok).toBe(false);
    expect(checkCardPatch({ block: 'partners' }).ok).toBe(false);
    expect(checkCardPatch({ tag: 'validated!' }).ok).toBe(false);
    expect(checkCardPatch([]).ok).toBe(false);
  });
});

describe('checkMove', () => {
  it('is up or down', () => {
    expect(checkMove({ direction: 'up' })).toEqual({ ok: true, value: 'up' });
    expect(checkMove({ direction: 'left' }).ok).toBe(false);
    expect(checkMove(null).ok).toBe(false);
  });
});

describe('places', () => {
  it('puts a new card after every live card of its block', () => {
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([1, 2, 7, 3])).toBe(8);
  });

  it('swaps a card with its neighbour, and moves nothing at either end', () => {
    expect(reordered(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(reordered(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(reordered(['a', 'b', 'c'], 'a', 'up')).toBeNull();
    expect(reordered(['a', 'b', 'c'], 'c', 'down')).toBeNull();
    expect(reordered(['a', 'b'], 'z', 'up')).toBeNull();
  });
});

describe('changesOf', () => {
  it('writes one change per field that differs, a value sent unchanged being none', () => {
    const changes = changesOf(CARD, {
      block: 'key_partners',
      tag: 'assumption',
      text_en: 'The Telegram channel (Persian)',
      source: 'D-427',
      note_fa: 'فرض',
    });
    expect(changes).toEqual([
      { kind: 'moved', field: null, previous: 'channels', next: 'key_partners' },
      {
        kind: 'edited',
        field: 'text_en',
        previous: 'The Telegram channel',
        next: 'The Telegram channel (Persian)',
      },
      { kind: 'edited', field: 'note_fa', previous: '', next: 'فرض' },
    ]);
    expect(changedReason(changes)).toBe('changed block, text_en, note_fa');
    expect(changesOf(CARD, { tag: 'risk' })).toEqual([
      { kind: 'tagged', field: null, previous: 'assumption', next: 'risk' },
    ]);
    expect(changedReason(changesOf(CARD, { tag: 'risk' }))).toBe('changed tag');
    expect(changesOf(CARD, { text_fa: 'کانال تلگرام', block: 'channels' })).toEqual([]);
  });

  it('says whether a card would still have a text', () => {
    expect(hasText({ text_fa: '', text_en: 'x' })).toBe(true);
    expect(hasText({ text_fa: ' ', text_en: '' })).toBe(false);
  });
});
