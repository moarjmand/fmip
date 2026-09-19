import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import {
  type ApiError,
  type FixtureNewsResponse,
  FIXTURE_NEWS_LIMIT,
  NEWS_PAGE_SIZE,
  NEWS_SECTIONS,
  type NewsFilters,
  type NewsSection,
  type NewsSectionReason,
  type NewsSectionResponse,
  type StoryPage,
  TRENDING_WINDOW_HOURS,
  isNewsSection,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ProfileService } from '../profile/profile.service';
import { PostgresNewsReadStore, type StoryPage_ } from './internal/news-read-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const NO_STORY: ApiError = { error: 'not_found', message: 'No such story.' };
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };

function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function bad(message: string): BadRequestException {
  const error: ApiError = { error: 'validation', message };
  return new BadRequestException(error);
}

/** A filter is an address: a malformed one is refused, not silently dropped. */
function uuidFilter(value: unknown, name: string): string | null {
  const v = first(value);
  if (v === undefined) return null;
  if (!UUID.test(v)) throw bad(`${name} must be an id.`);
  return v.toLowerCase();
}

function languageFilter(value: unknown): string | null {
  const v = first(value);
  if (v === undefined) return null;
  if (!LOCALE.test(v)) throw bad('language must be a language tag.');
  return v;
}

/** A locale is a preference, not an address: an odd one is `null`, never 400 (T-303). */
function localeOf(value: unknown): string | null {
  const v = first(value);
  return v !== undefined && LOCALE.test(v) ? v : null;
}

function beforeOf(value: unknown): string | null {
  const v = first(value);
  if (v === undefined) return null;
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) throw bad('before must be a time.');
  return at.toISOString();
}

/**
 * The news sections (blueprint 3.1, T-143): `GET /news?section=latest|
 * trending|debate|following`, with `country`, `competition`, `team` and
 * `language` filters (blueprint 3.2) and `before` to page latest and following.
 *
 * Public. A session is what makes `following` answerable; for a guest it is
 * `not_supplied` with the reason, not an empty list and not a 401 -- the page
 * is still a page, with one section that says what it needs.
 */
@Controller()
export class NewsController {
  constructor(
    private readonly store: PostgresNewsReadStore,
    private readonly identity: IdentityService,
    private readonly profiles: ProfileService,
  ) {}

  @Get('news')
  async section(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
  ): Promise<NewsSectionResponse> {
    const wanted = first(query.section) ?? 'latest';
    if (!isNewsSection(wanted)) {
      throw bad(`section must be one of ${NEWS_SECTIONS.join(', ')}.`);
    }
    const filters: NewsFilters = {
      country: uuidFilter(query.country, 'country'),
      competition: uuidFilter(query.competition, 'competition'),
      team: uuidFilter(query.team, 'team'),
      language: languageFilter(query.language),
    };
    const locale = localeOf(query.locale);
    const before = beforeOf(query.before);
    const filtered = Object.values(filters).some((f) => f !== null);
    const last_updated_at = await this.store.lastFetchedAt();

    const answer = (
      page: StoryPage_,
      coverage: 'available' | 'limited',
      whenEmpty: NewsSectionReason,
      whenFull: NewsSectionReason | null = null,
    ): NewsSectionResponse => ({
      section: wanted,
      filters,
      stories: { coverage, last_updated_at, data: page.cards },
      reason: page.cards.length === 0 ? (filtered ? 'no_match' : whenEmpty) : whenFull,
      next_before: page.nextBefore,
    });

    switch (wanted satisfies NewsSection) {
      case 'latest':
        return answer(
          await this.store.latest(filters, locale, before, NEWS_PAGE_SIZE),
          'available',
          'nothing_yet',
        );
      case 'trending':
        return answer(
          await this.store.trending(filters, locale, TRENDING_WINDOW_HOURS, NEWS_PAGE_SIZE),
          'limited',
          'nothing_trending',
          'discussion_only',
        );
      case 'debate':
        return answer(
          await this.store.debate(filters, locale, NEWS_PAGE_SIZE),
          'available',
          'nothing_selected',
        );
      case 'following': {
        const viewer = await this.identity.authenticate(
          parseCookies(request.headers.cookie)[SESSION_COOKIE],
        );
        if (viewer === null) {
          return {
            section: wanted,
            filters,
            stories: { coverage: 'not_supplied', last_updated_at, data: null },
            reason: 'needs_session',
            next_before: null,
          };
        }
        const followed = await this.profiles.listFollowing(viewer.id);
        const ids = (type: 'team' | 'competition' | 'person'): string[] =>
          followed.filter((f) => f.entity_type === type).map((f) => f.entity_id);
        if (followed.length === 0) {
          return {
            section: wanted,
            filters,
            stories: { coverage: 'available', last_updated_at, data: [] },
            reason: 'nothing_followed',
            next_before: null,
          };
        }
        return answer(
          await this.store.following(
            filters,
            locale,
            { teams: ids('team'), competitions: ids('competition'), persons: ids('person') },
            before,
            NEWS_PAGE_SIZE,
          ),
          'available',
          'no_match',
        );
      }
    }
  }

  /**
   * The story page (blueprint 3.3, T-144): `GET /news/stories/:id`, in
   * `?language=` when the original has a version in it. Unknown, or an
   * original whose publisher asked to be dropped, is 404: the words are gone
   * with them (D-061), and the story is not shown without its original.
   */
  @Get('news/stories/:id')
  async story(
    @Param('id') id: string,
    @Query('locale') locale: unknown,
    @Query('language') language: unknown,
  ): Promise<StoryPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_STORY);
    const page = await this.store.story(
      id.toLowerCase(),
      localeOf(locale),
      languageFilter(language),
    );
    if (page === null) throw new NotFoundException(NO_STORY);
    return page;
  }

  /**
   * Related news on the match centre (blueprint 4.2, T-145): `GET
   * /fixtures/:id/news`, the same cards as the news page, for stories linked
   * to the match or either side inside the window around kick-off. The list
   * is `available` -- possibly empty, and then `nothing_linked` -- only once
   * the feeds have been read at all; before that it is `not_supplied` with
   * `feeds_unread`, because an empty list nobody has looked for is not a fact
   * (rule 3). Public: a story is a headline and a link (D-061).
   */
  @Get('fixtures/:id/news')
  async fixtureNews(
    @Param('id') id: string,
    @Query('locale') locale: unknown,
  ): Promise<FixtureNewsResponse> {
    if (!UUID.test(id)) throw new NotFoundException(NO_FIXTURE);
    const fixtureId = id.toLowerCase();
    const [found, last_updated_at] = await Promise.all([
      this.store.forFixture(fixtureId, localeOf(locale), FIXTURE_NEWS_LIMIT),
      this.store.lastFetchedAt(),
    ]);
    if (found === null) throw new NotFoundException(NO_FIXTURE);
    const period = {
      since: found.window.since.toISOString(),
      until: found.window.until.toISOString(),
    };
    if (last_updated_at === null) {
      return {
        fixture_id: fixtureId,
        period,
        stories: { coverage: 'not_supplied', last_updated_at: null, data: null },
        reason: 'feeds_unread',
      };
    }
    return {
      fixture_id: fixtureId,
      period,
      stories: { coverage: 'available', last_updated_at, data: found.page.cards },
      reason: found.page.cards.length === 0 ? 'nothing_linked' : null,
    };
  }
}
