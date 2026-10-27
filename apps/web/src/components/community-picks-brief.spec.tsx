import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommunityPicksBrief } from './community-consensus';

// The homepage's community lane on a phone (T-1608): "Make your pick" was a
// 20px line of text, under the 44px target the rest of the page keeps.
describe('the community lane on the homepage', () => {
  const brief = (consensus: Parameters<typeof CommunityPicksBrief>[0]['consensus']) =>
    renderToStaticMarkup(
      <CommunityPicksBrief
        consensus={consensus}
        revealed={false}
        home="Arsenal"
        away="Chelsea"
        href="/en/match/m1"
        locale="en"
      />,
    );

  it('makes "Make your pick" a 44px target on a phone, a line of text from 768px', () => {
    const link = /<a[^>]*href="\/en\/match\/m1"[^>]*>/.exec(brief(null))?.[0] ?? '';
    expect(link).toContain('min-h-touch');
    expect(link).toContain('md:min-h-0');
  });
});
