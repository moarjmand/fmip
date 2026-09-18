import { describe, expect, it } from 'vitest';
import { NEWS_USER_AGENT, robotsAllows } from './robots';

describe('robotsAllows', () => {
  const ROBOTS = `# publisher's rules
User-agent: *
Disallow: /private/
Disallow: /feed/full
Allow: /feed/full/public

User-agent: fmip-news
Disallow: /feed/members

User-agent: badbot
Disallow: /
`;

  it('allows everything when there is no robots.txt or no group applies', () => {
    expect(robotsAllows('', '/feed.xml')).toBe(true);
    expect(robotsAllows('Sitemap: https://x.test/sitemap.xml', '/feed.xml')).toBe(true);
  });

  it('honours the group written for our own agent over the general one', () => {
    expect(robotsAllows(ROBOTS, '/feed/members', NEWS_USER_AGENT)).toBe(false);
    // The general group forbids /private/; ours does not mention it, and ours wins.
    expect(robotsAllows(ROBOTS, '/private/feed.xml', NEWS_USER_AGENT)).toBe(true);
  });

  it('applies the general group to an agent with no group of its own, longest rule winning', () => {
    expect(robotsAllows(ROBOTS, '/private/feed.xml', 'other')).toBe(false);
    expect(robotsAllows(ROBOTS, '/feed/full', 'other')).toBe(false);
    expect(robotsAllows(ROBOTS, '/feed/full/public.xml', 'other')).toBe(true);
    expect(robotsAllows(ROBOTS, '/feed.xml', 'other')).toBe(true);
  });

  it('reads an empty Disallow as nothing disallowed', () => {
    expect(robotsAllows('User-agent: *\nDisallow:', '/anything')).toBe(true);
  });

  it('is not fooled by case, comments or a missing colon', () => {
    expect(
      robotsAllows('USER-AGENT: FMIP-NEWS # ours\nDISALLOW: /x', '/x/feed', NEWS_USER_AGENT),
    ).toBe(false);
    expect(robotsAllows('nonsense line\nUser-agent: *\nDisallow: /y', '/y')).toBe(false);
  });
});
