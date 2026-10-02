import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionForm } from './action-form';

const action = async () => null;
const fields = [
  { name: 'territory', label: 'Territory', type: 'text' as const, required: true, hint: 'IR' },
  { name: 'note', label: 'Note', type: 'text' as const, required: true },
];

/**
 * Two forms on one page naming the same field (T-1363): the match page's
 * desk has three `territory` fields and the Watch console two `note` fields.
 * Every id on the page is unique and every label points at its own input.
 */
describe('ActionForm ids', () => {
  it('gives each form its own field ids, so labels never point at another form', () => {
    const html = renderToStaticMarkup(
      <>
        <ActionForm action={action} fields={fields} submitLabel="Declare" />
        <ActionForm action={action} fields={fields} submitLabel="Set default" />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
    const targets = [...html.matchAll(/\sfor="([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(ids).toContain(target);
  });
});
