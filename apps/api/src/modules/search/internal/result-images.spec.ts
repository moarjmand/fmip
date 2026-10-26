import type { EntityMedia, SearchResult } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { imageRequest, withImages } from './result-images';

/** Each search result's image (T-1617): the right kind per type, one read, none invented. */

const result = (type: SearchResult['type'], id: string): SearchResult => ({
  type,
  id,
  name: id,
  secondary: null,
  matched_on: 'name',
  alias: null,
  score: 1,
});

const at = (kind: string, id: string): EntityMedia => ({
  coverage: 'available',
  url: `/api/media/${kind}/${id}/0123456789ab.png`,
});
const NONE: EntityMedia = { coverage: 'not_supplied', url: null };

describe('search result images (T-1617)', () => {
  const page = [result('team', 't1'), result('competition', 'c1'), result('person', 'p1')];

  it('asks for every result in one read, each under its own type', () => {
    expect(imageRequest(page)).toEqual({ team: ['t1'], competition: ['c1'], person: ['p1'] });
    expect(imageRequest([])).toEqual({ team: [], competition: [], person: [] });
  });

  it('gives a team its crest, a competition its logo and a person a photo, or says there is none', () => {
    const media = {
      crest: (id: string) => at('crest', id),
      logo: (id: string) => at('logo', id),
      photo: () => NONE,
    };
    expect(withImages(page, media).map((r) => r.image)).toEqual([
      at('crest', 't1'),
      at('logo', 'c1'),
      NONE,
    ]);
    // Nothing else about a result moves.
    expect(withImages(page, media)[0]).toMatchObject({ type: 'team', id: 't1', score: 1 });
  });
});
