import type { MatchHeader, VenueDetails } from '@fmip/contracts';
import { NO_MEDIA } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { matchWords } from '@/lib/words-server';
import { VenueCard } from './venue-card';

/**
 * The ground's card on the match page (T-1438, D-229): what the source says
 * about the ground, a fact it did not give left out rather than drawn as
 * zero, and one sentence when it gave none -- not yet fetched, or not
 * described -- with the coverage beside the title.
 */

const details = (over: Partial<VenueDetails> = {}): VenueDetails => ({
  address: 'Sir Matt Busby Way',
  capacity: 76212,
  surface: 'grass',
  image: { coverage: 'available', url: '/api/media/venue/v1/abc123' },
  coverage: 'available',
  ...over,
});
const venue = (d: VenueDetails | undefined): MatchHeader['venue'] => ({
  id: 'v1',
  name: 'Old Trafford',
  city: 'Manchester',
  ...(d === undefined ? {} : { details: d }),
});
const render = (v: MatchHeader['venue'], locale = 'en') =>
  renderToStaticMarkup(<VenueCard venue={v} locale={locale} words={matchWords(locale)} />);

describe("the ground's card (T-1438)", () => {
  it('shows the picture from our own origin, the name, capacity, surface and address', () => {
    const html = render(venue(details()));
    expect(html).toContain('data-coverage="available"');
    expect(html).toContain('src="/api/media/venue/v1/abc123"');
    expect(html).toContain('Old Trafford');
    expect(html).toContain('Manchester');
    expect(html).toContain('Capacity 76,212');
    expect(html).toContain('Grass pitch');
    expect(html).toContain('Sir Matt Busby Way');
  });

  it('leaves out what the source did not give, and draws no picture it does not hold', () => {
    const html = render(
      venue(details({ capacity: null, address: null, image: NO_MEDIA, coverage: 'limited' })),
    );
    expect(html).toContain('data-coverage="limited"');
    expect(html).not.toContain('Capacity');
    expect(html).not.toContain('venue-address');
    expect(html).not.toContain('<img');
    // A provider's address is never drawn: only our own.
    expect(
      render(venue(details({ image: { coverage: 'available', url: 'https://x.test/a.png' } }))),
    ).not.toContain('<img');
  });

  it('says whether the ground was not described or not fetched yet', () => {
    const none = { address: null, capacity: null, surface: null, image: NO_MEDIA };
    expect(render(venue(details({ ...none, coverage: 'not_supplied' })))).toContain(
      'The source does not describe this ground.',
    );
    expect(render(venue(details({ ...none, coverage: 'delayed' })))).toContain(
      'details have not been fetched yet',
    );
  });

  it('is nothing without a ground or without its card', () => {
    expect(render(null)).toBe('');
    expect(render(venue(undefined))).toBe('');
  });

  it('says it in Persian, with Persian digits', () => {
    const html = render(venue(details({ surface: 'artificial' })), 'fa');
    expect(html).toContain('ورزشگاه');
    expect(html).toContain('گنجایش ۷۶٬۲۱۲');
    expect(html).toContain('چمن مصنوعی');
  });
});
