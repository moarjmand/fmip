import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Receipt } from './receipt';

/** The model's receipt (the Design System's `Receipt`, T-1508): facts joined with " · ". */

describe('Receipt', () => {
  it('joins its facts with a middle dot, in the mono face and the model colour', () => {
    const html = renderToStaticMarkup(<Receipt items={['model 0.6.0', 'v3', 'computed 09:30']} />);
    expect(html).toContain('data-testid="receipt"');
    expect(html).toContain('font-mono');
    expect(html).toContain('text-model');
    expect(html).toContain(
      '<span>model 0.6.0</span><span aria-hidden="true">·</span><span>v3</span><span aria-hidden="true">·</span><span>computed 09:30</span>',
    );
  });

  it('sits on a dashed rule, never on a tint of the model colour', () => {
    const html = renderToStaticMarkup(<Receipt items={['v1']} />);
    expect(html).toContain('border-t border-dashed border-default');
    expect(html).not.toMatch(/bg-model/);
  });

  it('leaves out an empty fact rather than a dangling dot', () => {
    const html = renderToStaticMarkup(<Receipt items={['v1', null, undefined, false, 'now']} />);
    expect(html.match(/·/g)).toHaveLength(1);
  });

  it('sets Persian in the interface face, and writes no physical side', () => {
    const html = renderToStaticMarkup(<Receipt items={['نسخه ۳']} testId="x" />);
    expect(html).toContain('[:root:is(:lang(fa),:lang(ar))_&amp;]:font-sans');
    expect(html).toContain('data-testid="x"');
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
  });
});
