import { Controller, ForbiddenException, Get, Req, UnauthorizedException } from '@nestjs/common';
import {
  type ApiError,
  NEWS_COVERAGE_FLOOR,
  NEWS_COVERAGE_WINDOW_DAYS,
  type NewsCoverageReport,
  ROLE_REFUSALS,
  newsCoverageState,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresNewsCoverageStore } from './internal/news-coverage-store';
import { PostgresNewsReadStore } from './internal/news-read-store';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const ORDER = { no_carried_source: 0, below_floor: 1, covered: 2 } as const;

/**
 * News coverage per competition, stated (blueprint 3.2, T-1010, D-129):
 * `GET /admin/news/coverage` lists every active competition with the carried
 * sources that linked a story to it in the window and the count, the gaps
 * first. Editors and administrators. A read only: it names the gaps and adds
 * no source -- which publishers to carry is the maintainer's (N-8).
 */
@Controller('admin/news')
export class NewsCoverageAdminController {
  constructor(
    private readonly coverage: PostgresNewsCoverageStore,
    private readonly read: PostgresNewsReadStore,
    private readonly identity: IdentityService,
  ) {}

  @Get('coverage')
  async report(@Req() request: FastifyRequest): Promise<NewsCoverageReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(ROLE_REFUSALS.editor);

    const [competitions, byId, carried, feedsReadAt] = await Promise.all([
      this.coverage.activeCompetitions(),
      this.coverage.coverage(null, NEWS_COVERAGE_WINDOW_DAYS, NEWS_COVERAGE_FLOOR),
      this.coverage.carriedSources(),
      this.read.lastFetchedAt(),
    ]);
    const rows = competitions.map((competition) => {
      const coverage =
        byId.get(competition.id) ??
        PostgresNewsCoverageStore.empty(NEWS_COVERAGE_WINDOW_DAYS, NEWS_COVERAGE_FLOOR);
      return {
        competition,
        state: newsCoverageState(coverage.stories, coverage.floor),
        coverage,
      };
    });
    // The gaps first; inside a state, the active-competition order (tier, then name).
    const ranked = rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => ORDER[a.row.state] - ORDER[b.row.state] || a.index - b.index)
      .map(({ row }) => row);
    return {
      generated_at: new Date().toISOString(),
      window_days: NEWS_COVERAGE_WINDOW_DAYS,
      floor: NEWS_COVERAGE_FLOOR,
      carried_sources: carried,
      feeds_read_at: feedsReadAt,
      competitions: ranked,
    };
  }
}
