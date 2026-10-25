import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommunityVoice, FounderVoice, ModelVoice, ThreeProductsNote } from './voices';

/**
 * The three prediction voices (the Design System's `Voice`, T-1509; rule 6):
 * three components, each told apart by how its name is set, each with an
 * honest empty state, each a section named for screen readers.
 */

const voices = (locale = 'en') =>
  [
    [renderToStaticMarkup(<ModelVoice locale={locale}>x</ModelVoice>), 'model'],
    [renderToStaticMarkup(<FounderVoice locale={locale}>x</FounderVoice>), 'founder'],
    [renderToStaticMarkup(<CommunityVoice locale={locale}>x</CommunityVoice>), 'community'],
  ] as const;

describe('the three voices', () => {
  it('give each product its own card, name and look, and borrow nothing from another', () => {
    const names = {
      model: 'Statistical model',
      founder: 'Founder’s analysis',
      community: 'Community picks',
    };
    for (const [html, voice] of voices()) {
      expect(html).toContain(`data-voice="${voice}"`);
      expect(html).toContain('rounded-xl border border-default bg-surface');
      expect(html).toContain(names[voice]);
      expect(html).toContain(`text-${voice}`);
      for (const other of ['model', 'founder', 'community'].filter((o) => o !== voice)) {
        expect(html).not.toContain(`-${other}`);
      }
    }
  });

  it('set the model as a mono tag, the founder in the serif italic, the community in capitals', () => {
    const [[model], [founder], [community]] = voices();
    expect(model).toMatch(/class="[^"]*border border-model[^"]*font-mono[^"]*uppercase/);
    expect(founder).toMatch(/class="font-serif[^"]*italic/);
    expect(community).toMatch(/class="text-xs font-extrabold[^"]*uppercase/);
    // Only the founder is in the serif; only the model in the mono face.
    expect(model + community).not.toContain('font-serif');
    expect(founder + community).not.toContain('font-mono');
  });

  it('keep the model’s colour off a tint: its tag is an outline on the card', () => {
    const [[model]] = voices();
    expect(model).not.toMatch(/bg-model/);
  });

  it('are sections named by their own name line', () => {
    for (const [html] of voices()) {
      const id = /<p id="([^"]+)"/.exec(html)?.[1];
      expect(id).toBeDefined();
      expect(html).toContain(`<section aria-labelledby="${id}"`);
    }
  });

  it('say why there is nothing to show, in place of the content, never an empty card', () => {
    const html = renderToStaticMarkup(
      <FounderVoice locale="en" empty="Not published for this match yet.">
        never shown
      </FounderVoice>,
    );
    expect(html).toContain('data-voice-empty=""');
    expect(html).toContain('Not published for this match yet.');
    expect(html).not.toContain('never shown');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    for (const Voice of [ModelVoice, CommunityVoice]) {
      expect(renderToStaticMarkup(<Voice locale="en" empty="None yet." />)).toContain('None yet.');
    }
  });

  it('give the community its sample size beside its name when one is given', () => {
    expect(renderToStaticMarkup(<CommunityVoice locale="en" count={412} />)).toContain(
      'Community picks · 412 members have picked',
    );
    expect(renderToStaticMarkup(<CommunityVoice locale="en" count={1} />)).toContain(
      '1 member has picked',
    );
    expect(renderToStaticMarkup(<CommunityVoice locale="en" />)).not.toContain('picked');
  });

  it('speak Persian, with the founder in Markazi and nothing physical', () => {
    const html = voices('fa')
      .map(([h]) => h)
      .join('');
    expect(html).toContain('مدل آماری');
    expect(html).toContain('[:root:is(:lang(fa),:lang(ar))_&amp;]:font-naskh');
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/);
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it('meet once on a page with the note that they stay separate', () => {
    expect(renderToStaticMarkup(<ThreeProductsNote locale="en" />)).toContain(
      'Three separate products.',
    );
  });
});
