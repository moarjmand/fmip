import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductRow } from './product-row';
import { CommunityVoice, FounderVoice, ModelVoice } from './voices';

/**
 * The compact row (T-1744, D-365; board P2-2): what stands where a card
 * would have looked like something to read. The rule-6 side of it -- no prop
 * that chooses a product, none of the model's colour -- is read from the
 * source in `three-products.spec.ts`; this renders it.
 */
describe('the compact row', () => {
  const row = renderToStaticMarkup(
    <ProductRow
      name={<h2 id="n">Approved contributors</h2>}
      status={<span>None yet</span>}
      labelledBy="n"
      testId="row"
      state="none"
    >
      Nobody has published an analysis.
    </ProductRow>,
  );

  it('is a named section: the name, the sentence and the status', () => {
    expect(row).toMatch(/^<section aria-labelledby="n"/);
    expect(row).toContain('data-product-row=""');
    expect(row).toContain('data-testid="row"');
    expect(row).toContain('data-state="none"');
    expect(row).toContain('<h2 id="n">Approved contributors</h2>');
    expect(row).toMatch(/data-row-status="">(<span>)?None yet/);
    expect(row).toMatch(/data-row-sentence="">Nobody has published an analysis\./);
  });

  it('puts the name and the status on the first line on a phone, all three on one line from 768px', () => {
    const classes = /^<section[^>]*class="([^"]*)"/.exec(row)?.[1] ?? '';
    expect(classes).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(classes).toContain('md:grid-cols-[12rem_minmax(0,1fr)_auto]');
    expect(row).toMatch(/class="col-start-2 row-start-1 md:col-start-3" data-row-status/);
    expect(row).toMatch(/class="col-span-2 [^"]*md:col-start-2 md:row-start-1" data-row-sentence/);
  });

  it('draws no status box when it is handed none', () => {
    const bare = renderToStaticMarkup(<ProductRow name={<b>Name</b>}>Sentence.</ProductRow>);
    expect(bare).not.toContain('data-row-status');
    expect(bare).not.toContain('aria-labelledby');
  });

  it('uses logical properties only and no colour of a product (rules 6 and 7)', () => {
    expect(row).not.toMatch(
      /class="[^"]*(?<![\w-])(left|right|ml|mr|pl|pr|text-left|text-right)-[^"]*"/,
    );
    expect(row).not.toMatch(/(text|bg|border)-(model|founder|community)/);
  });
});

describe('a voice as a row', () => {
  const status = <span data-testid="status">None yet</span>;

  it('the founder’s row keeps the founder’s own name and face', () => {
    const html = renderToStaticMarkup(
      <FounderVoice locale="en" empty="No analysis." row={status} testId="f" state="none" />,
    );
    expect(html).toContain('data-product-row=""');
    expect(html).toContain('data-voice="founder"');
    expect(html).toContain('data-testid="f"');
    expect(html).toMatch(/class="[^"]*font-serif[^"]*text-founder[^"]*italic[^"]*"/);
    expect(html).toContain('No analysis.');
    expect(html).toContain('data-testid="status"');
    // The row is named by the voice's name line.
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<p id="${id}"`);
  });

  it('the community’s row keeps the community’s own name', () => {
    const html = renderToStaticMarkup(
      <CommunityVoice locale="en" empty="No consensus." row={status} />,
    );
    expect(html).toContain('data-product-row=""');
    expect(html).toContain('data-voice="community"');
    expect(html).toMatch(/class="[^"]*text-community[^"]*uppercase[^"]*"/);
    expect(html).toContain('Community picks');
  });

  it('without `row` an empty voice is the card it was', () => {
    const html = renderToStaticMarkup(<FounderVoice locale="en" empty="No analysis." />);
    expect(html).not.toContain('data-product-row');
    expect(html).toContain('data-voice-empty=""');
  });

  it('is Persian on /fa, the founder’s name in the Naskh face and upright', () => {
    const html = renderToStaticMarkup(
      <FounderVoice locale="fa" empty="x" row={status} testId="f" />,
    );
    expect(html).toContain('تحلیل بنیان‌گذار');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('the model’s voice has no row: its forecast is the Summary’s card', () => {
    // @ts-expect-error -- `row` is not a prop of the model's voice.
    const html = renderToStaticMarkup(<ModelVoice locale="en" empty="None." row={status} />);
    expect(html).not.toContain('data-product-row');
    expect(html).toContain('data-voice="model"');
  });
});
