import { CONSOLE_CHECKLIST_NOTE_MAX, CONSOLE_CHECKLIST_TITLE_MAX } from '@fmip/contracts/console';
import { describe, expect, it } from 'vitest';
import {
  changesOf,
  checkItemPatch,
  checkMove,
  checkNewItem,
  checkNote,
  checkRemoval,
} from './checklist-rules';

/** T-1840 (D-428): what a person may write to the pre-launch checklist. */
const SECTION = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PERSON = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('checkNewItem', () => {
  it('takes a section and trimmed text', () => {
    expect(checkNewItem({ section_id: SECTION, title: '  آزمایش ورود  ' })).toEqual({
      ok: true,
      value: { section_id: SECTION, title: 'آزمایش ورود' },
    });
  });

  it('refuses no text, too long a text and a section that is not an id', () => {
    expect(checkNewItem({ section_id: SECTION, title: '   ' }).ok).toBe(false);
    expect(
      checkNewItem({ section_id: SECTION, title: 'x'.repeat(CONSOLE_CHECKLIST_TITLE_MAX + 1) }).ok,
    ).toBe(false);
    expect(checkNewItem({ section_id: 'friends', title: 'x' }).ok).toBe(false);
    expect(checkNewItem('x').ok).toBe(false);
  });
});

describe('checkItemPatch', () => {
  it('takes any of the fields, and the three kinds of assignee', () => {
    expect(checkItemPatch({ status: 'blocked' })).toEqual({ ok: true, value: { status: 'blocked' } });
    expect(checkItemPatch({ assignee: null })).toEqual({ ok: true, value: { assignee: null } });
    expect(checkItemPatch({ assignee: 'agents' })).toEqual({
      ok: true,
      value: { assignee: 'agents' },
    });
    expect(checkItemPatch({ assignee: PERSON, title: ' تازه ' })).toEqual({
      ok: true,
      value: { assignee: PERSON, title: 'تازه' },
    });
  });

  it('refuses an empty change, an unknown status and an assignee that is a name', () => {
    expect(checkItemPatch({}).ok).toBe(false);
    expect(checkItemPatch({ status: 'finished' }).ok).toBe(false);
    expect(checkItemPatch({ assignee: 'mostafa' }).ok).toBe(false);
    expect(checkItemPatch({ title: '' }).ok).toBe(false);
    expect(checkItemPatch({ section_id: 'x' }).ok).toBe(false);
  });
});

describe('notes, moves and removals', () => {
  it('takes a note up to its length', () => {
    expect(checkNote({ body: ' یادداشت ' })).toEqual({ ok: true, value: 'یادداشت' });
    expect(checkNote({ body: '' }).ok).toBe(false);
    expect(checkNote({ body: 'x'.repeat(CONSOLE_CHECKLIST_NOTE_MAX + 1) }).ok).toBe(false);
  });

  it('moves up or down only', () => {
    expect(checkMove({ direction: 'up' })).toEqual({ ok: true, value: 'up' });
    expect(checkMove({ direction: 'left' }).ok).toBe(false);
  });

  it('removes only with a reason', () => {
    expect(checkRemoval({ reason: ' تکراری ' })).toEqual({ ok: true, value: 'تکراری' });
    expect(checkRemoval({}).ok).toBe(false);
    expect(checkRemoval(undefined).ok).toBe(false);
  });
});

describe('changesOf', () => {
  const before = {
    title: 'الف',
    section_id: SECTION,
    status: 'not_started' as const,
    assignee: null,
  };

  it('records one change per field that really changes, with before and after', () => {
    expect(changesOf(before, { status: 'done', assignee: 'agents', title: 'الف' })).toEqual([
      { kind: 'status', previous: 'not_started', next: 'done' },
      { kind: 'assigned', previous: null, next: 'agents' },
    ]);
  });

  it('records nothing for a value sent unchanged', () => {
    expect(changesOf(before, { status: 'not_started', assignee: null })).toEqual([]);
  });
});
