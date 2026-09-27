import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from './card';
import { FormStatus, Notice, noticeRole } from './notice';

/**
 * Notices, form results and cards (T-603). A refusal interrupts and a
 * confirmation waits its turn; the colour and the live-region role come from
 * the same word, so they cannot disagree.
 */

describe('Notice', () => {
  it('interrupts for danger and warning, and waits for information and success', () => {
    expect(noticeRole('danger')).toBe('alert');
    expect(noticeRole('warning')).toBe('alert');
    expect(noticeRole('info')).toBe('status');
    expect(noticeRole('success')).toBe('status');
  });

  it('draws each tone in its token, never a palette colour', () => {
    for (const [tone, token] of [
      ['danger', 'text-danger'],
      ['warning', 'text-warning'],
      ['success', 'text-success'],
      ['info', 'bg-surface'],
    ] as const) {
      const html = renderToStaticMarkup(<Notice tone={tone}>x</Notice>);
      expect(html, tone).toContain(token);
      expect(html, tone).toContain(`role="${noticeRole(tone)}"`);
    }
  });

  it('keeps a test id and lets the caller choose the element and the role', () => {
    const html = renderToStaticMarkup(
      <Notice tone="danger" as="div" role="status" data-testid="x-unreachable">
        Cannot be shown.
      </Notice>,
    );
    expect(html).toMatch(/^<div /);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-testid="x-unreachable"');
  });
});

describe('FormStatus', () => {
  it('says a success quietly and a refusal as an alert', () => {
    const ok = renderToStaticMarkup(<FormStatus ok>Saved.</FormStatus>);
    expect(ok).toBe('<p role="status" class="text-sm text-muted">Saved.</p>');
    const refused = renderToStaticMarkup(
      <FormStatus ok={false} data-testid="x-result">
        Not allowed.
      </FormStatus>,
    );
    expect(refused).toContain('role="alert"');
    expect(refused).toContain('text-danger');
    expect(refused).toContain('data-testid="x-result"');
  });

  it('sits on the button’s line as a span, and boxes itself for the account forms', () => {
    const inline = renderToStaticMarkup(
      <FormStatus ok={false} as="span" size="xs" className="ms-2">
        No.
      </FormStatus>,
    );
    expect(inline).toBe('<span role="alert" class="text-xs text-danger ms-2">No.</span>');
    const boxed = renderToStaticMarkup(
      <FormStatus ok boxed>
        Done.
      </FormStatus>,
    );
    expect(boxed).toContain('rounded border');
    expect(boxed).toContain('border-success text-success');
  });
});

describe('Card', () => {
  it('is a surface with a hairline edge, and a named region when it has a heading', () => {
    const html = renderToStaticMarkup(<Card heading="Grant by username">body</Card>);
    expect(html).toMatch(/^<section aria-labelledby="(card[^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(
      `<h2 id="${String(id)}" class="text-lg font-semibold">Grant by username</h2>`,
    );
    expect(html).toContain('bg-surface');
    expect(html).toContain('border-default');
  });

  it('is a plain box, or the list item it was asked to be, without one', () => {
    expect(renderToStaticMarkup(<Card>body</Card>)).toMatch(/^<div class="/);
    const item = renderToStaticMarkup(
      <Card as="li" padding="sm" data-testid="panel-post">
        body
      </Card>,
    );
    expect(item).toMatch(/^<li /);
    expect(item).not.toContain('aria-labelledby');
    expect(item).toContain('gap-2 p-3');
    expect(item).toContain('data-testid="panel-post"');
  });
});
