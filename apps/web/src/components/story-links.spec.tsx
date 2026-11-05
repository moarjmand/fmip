import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FollowedEntity, NewsEntity } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/story-actions', () => ({ storyFollowAction: async () => undefined }));

const { StoryFollowControls, followableEntities } = await import('./story-links');

/**
 * The story page's share and follow controls (T-941, blueprint 3.3).
 */
const STORY = readFileSync(
  join(__dirname, '..', 'app', '[locale]', 'news', 'story', '[id]', 'page.tsx'),
  'utf8',
);

const TEAM: NewsEntity = {
  entity_type: 'team',
  entity_id: '00000000-0000-4000-8000-000000000401',
  name: 'Liverpool',
  localised_name: null,
};
const COMPETITION: NewsEntity = {
  entity_type: 'competition',
  entity_id: '00000000-0000-4000-8000-000000000201',
  name: 'Premier League',
  localised_name: null,
};
const PERSON: NewsEntity = {
  entity_type: 'person',
  entity_id: '00000000-0000-4000-8000-000000000601',
  name: 'Mohamed Salah',
  localised_name: null,
};
const FOLLOWED: FollowedEntity = {
  entity_type: 'team',
  entity_id: TEAM.entity_id,
  name: 'Liverpool',
  favourite: false,
  followed_at: '2026-09-01T10:00:00.000Z',
};

const follow = (signedIn: boolean, following: FollowedEntity[] | null, locale = 'en') =>
  renderToStaticMarkup(
    <StoryFollowControls
      locale={locale}
      storyId="00000000-0000-4000-8000-000000000001"
      entities={followableEntities([TEAM, PERSON, COMPETITION])}
      signedIn={signedIn}
      following={following}
    />,
  );

describe('follow controls on a story (T-941)', () => {
  it('offers the teams and competitions it links, never a person, each saying its state', () => {
    const html = follow(true, [FOLLOWED]);
    expect(html).toContain('data-testid="story-follow"');
    expect(html).not.toContain('Mohamed Salah');
    // Liverpool is followed: said, and the button unfollows it.
    expect(html).toMatch(/Liverpool.*story-following.*story-unfollow/s);
    expect(html).toContain('value="unfollow"');
    // The competition is not: the button follows it, and names it for a screen reader.
    expect(html).toContain('data-testid="story-follow-button"');
    expect(html).toMatch(/<span class="sr-only"> ?Premier League<\/span>/);
  });

  it('asks a guest to sign in, and says so when follows cannot be read', () => {
    expect(follow(false, null)).toContain('data-testid="story-follow-sign-in"');
    const broken = follow(true, null);
    expect(broken).toContain('data-testid="story-follow-unavailable"');
    expect(broken).not.toContain('<button');
  });

  it('renders nothing when the story links no team or competition', () => {
    expect(
      renderToStaticMarkup(
        <StoryFollowControls
          locale="en"
          storyId="s"
          entities={followableEntities([PERSON])}
          signedIn
          following={[]}
        />,
      ),
    ).toBe('');
  });

  it('marks untranslated words as English on another locale', () => {
    expect(follow(false, null, 'ar')).toContain('data-translation="untranslated"');
  });
});

describe('the story page’s onward controls (T-941)', () => {
  it('places share, follow and the predictions card, and the old sentence is gone', () => {
    // The predictions card is `story-predictions.tsx` since T-1741 (D-362);
    // `story-predictions.spec.tsx` covers it and what the page reads for it.
    expect(STORY).toContain('<StoryPredictions');
    expect(STORY).not.toContain('StoryPredictionLinks');
    expect(STORY).toContain('<StoryFollowControls');
    expect(STORY).toContain('<ShareLink');
    expect(STORY).not.toContain('story.notYet');
    expect(STORY).not.toMatch(/save and share are not built/i);
  });
});
