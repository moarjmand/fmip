import type {
  ConversationSummary,
  FriendPrediction,
  PanelLatest,
  ScoreCard,
} from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FriendPredictionsSection, GroupDiscussionsSection, PanelsSection } from './home-member';

/**
 * The homepage's member sections and today's panels (T-942, D-115),
 * rendered: each section says once when it has nothing, says so when it
 * could not be loaded, and a friend's call is labelled as a member's own and
 * never as the model's or the community's (rule 6).
 */

const call = (over: Partial<FriendPrediction> = {}): FriendPrediction => ({
  username: 'ada',
  display_name: 'Ada',
  fixture: {
    id: 'f1',
    kickoff_at: '2026-10-04T14:00:00Z',
    status: 'scheduled',
    competition: { id: 'c', name: 'League' },
    home: { id: 'h', name: 'Home FC', short_name: 'HFC' },
    away: { id: 'a', name: 'Away FC', short_name: null },
    score: null,
  },
  version: {
    id: 'v',
    version_number: 1,
    outcome: 'home',
    score: { home: 2, away: 1 },
    confidence: 3,
    reason_tags: [],
    explanation: null,
    submitted_at: '2026-10-01T10:00:00Z',
  },
  revisions: 1,
  settlement: null,
  ...over,
});

const friends = (result: FriendPrediction[] | null) =>
  renderToStaticMarkup(<FriendPredictionsSection locale="en" timeZone="UTC" result={result} />);

describe("the homepage's friends' predictions", () => {
  it('shows who called what, on which match, as their own call', () => {
    const html = friends([call()]);
    expect(html).toContain('Ada');
    // The score is its own left-to-right run (T-1302), so the words are read without tags.
    expect(html.replace(/<[^>]+>/g, '')).toContain('called HFC to win (2–1)');
    expect(html).toContain('href="/en/match/f1"');
    expect(html).toMatch(/Not\s+the model&#x27;s forecast|Not the model’s forecast/);
    // No probability and no consensus wording beside a member's call.
    expect(html).not.toMatch(/%|consensus/i);
  });

  it('repeats the stored settlement and computes none', () => {
    const settled = call({
      fixture: { ...call().fixture, status: 'finished', score: { home: 0, away: 3 } },
      settlement: {
        id: 's',
        status: 'settled',
        void_reason: null,
        actual: { home: 0, away: 3 },
        // Deliberately at odds with the score: the page says what was stored.
        outcome_correct: true,
        score_predicted: true,
        score_correct: false,
        confidence: 3,
        settled_at: '2026-10-04T16:00:00Z',
        version_number: 1,
      },
    });
    expect(friends([settled])).toContain('· right');
  });

  it('says once that there is nothing, and differently when it could not be loaded', () => {
    const empty = friends([]);
    expect(empty.match(/data-testid="home-friend-predictions-empty"/g)).toHaveLength(1);
    expect(friends(null)).toContain('home-friend-predictions-unreachable');
  });

  it('names a deleted friend from the catalogue, never by a stored name', () => {
    const html = friends([
      call({ username: 'deleted_0123456789ab', display_name: 'Deleted member' }),
    ]);
    expect(html).not.toContain('Deleted member');
    expect(html).toContain('data-member="deleted"');
  });
});

const discussion = (over: Partial<ConversationSummary> = {}): ConversationSummary =>
  ({
    id: 'c1',
    kind: 'group',
    group: { slug: 'g', name: 'The Group' },
    fixture: null,
    members: [],
    last_message: {
      id: 'm',
      seq: 3,
      author: 'bo',
      body: 'who starts up front?',
      reply_to_id: null,
      created_at: '2026-10-01T10:00:00Z',
      removed: null,
      card: null,
      reactions: [],
      mentions: [],
      pinned: false,
    },
    unread: 2,
    muted: false,
    left: false,
    ...over,
  }) as ConversationSummary;

describe("the homepage's group discussions", () => {
  it('links the discussion and shows its newest message', () => {
    const html = renderToStaticMarkup(
      <GroupDiscussionsSection locale="en" viewer="ada" result={[discussion()]} />,
    );
    expect(html).toContain('href="/en/messages/c1"');
    expect(html).toContain('who starts up front?');
    expect(html).toContain('2 unread');
  });

  it('says once that nothing was said, and differently when it could not be loaded', () => {
    const empty = renderToStaticMarkup(
      <GroupDiscussionsSection locale="en" viewer="ada" result={[]} />,
    );
    expect(empty.match(/home-group-discussions-empty/g)).toHaveLength(1);
    const failed = renderToStaticMarkup(
      <GroupDiscussionsSection locale="en" viewer="ada" result={null} />,
    );
    expect(failed).toContain('home-group-discussions-unreachable');
  });
});

describe("the homepage's panels", () => {
  const panel: PanelLatest = {
    fixture_id: 'f1',
    state: 'open',
    total: 5,
    posts: [
      {
        id: 'p1',
        author: {
          username: 'cara',
          display_name: 'Cara',
          rating: 82,
          tier: 'platinum',
          approved: true,
        },
        body: 'City press high.',
        created_at: '2026-10-01T10:00:00Z',
        removed: null,
        reactions: [],
        link: null,
      },
    ],
  };
  const cards = new Map([
    ['f1', { home: { name: 'Home FC' }, away: { name: 'Away FC' } } as unknown as ScoreCard],
  ]);

  it("shows the contributor's post with their standing, and how many more there are", () => {
    const html = renderToStaticMarkup(<PanelsSection locale="en" panels={[panel]} cards={cards} />);
    expect(html).toContain('Home FC v Away FC');
    expect(html).toContain('City press high.');
    expect(html).toContain('Platinum · 82');
    expect(html).toContain('5 posts in all');
  });

  it('says once that nothing was posted, and differently when it could not be loaded', () => {
    const empty = renderToStaticMarkup(<PanelsSection locale="en" panels={[]} cards={cards} />);
    expect(empty.match(/home-panels-empty/g)).toHaveLength(1);
    const failed = renderToStaticMarkup(<PanelsSection locale="en" panels={null} cards={cards} />);
    expect(failed).toContain('home-panels-unreachable');
  });
});

describe('the homepage in Persian (T-1302)', () => {
  it("renders a group's discussion in Persian, with the count in Persian digits", () => {
    const html = renderToStaticMarkup(
      <GroupDiscussionsSection locale="fa" viewer="ada" result={[discussion()]} />,
    );
    expect(html).toContain('در گروه‌های شما');
    expect(html).toContain('۲ خوانده‌نشده');
    expect(html).not.toContain('data-translation="untranslated"');
  });

  it('says in Persian that a section is empty or could not be loaded', () => {
    expect(
      renderToStaticMarkup(<FriendPredictionsSection locale="fa" timeZone="UTC" result={null} />),
    ).toContain('پیش‌بینی‌های دوستان شما بارگیری نشد.');
    expect(
      renderToStaticMarkup(<PanelsSection locale="fa" panels={[]} cards={new Map()} />),
    ).toContain('هنوز چیزی در میزگردهای مسابقه‌های امروز منتشر نشده است.');
  });
});
