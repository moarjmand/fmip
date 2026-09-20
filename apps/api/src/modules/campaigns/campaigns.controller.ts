import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  Audience,
  AuthUser,
  AudienceFilter,
  AudienceFollowType,
  AudiencesResponse,
  Campaign,
  CampaignDispatch,
  CampaignsResponse,
  CreateAudienceRequest,
  CreateCampaignRequest,
  SendCampaignRequest,
} from '@fmip/contracts';
import { AUDIENCE_FOLLOW_TYPES } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { CampaignsService } from './campaigns.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'This needs the administrator role.',
};
const NO_CAMPAIGN: ApiError = { error: 'not_found', message: 'No such campaign.' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string): never {
  throw new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

function word(value: unknown, name: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') invalid(`${name} is required.`);
  if (text.length > max) invalid(`${name} is at most ${max} characters.`);
  return text;
}

/** A filter with only the words the vocabulary has, each of the shape it has. */
function filterOf(raw: unknown): AudienceFilter {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid('filter is required.');
  const input = raw as Record<string, unknown>;
  const known = ['follows', 'country_id', 'language', 'verified_only', 'joined_after'];
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) invalid(`filter.${key} is not a condition the audience can have.`);
  }
  const filter: AudienceFilter = {};
  if (input.follows !== undefined && input.follows !== null) {
    const follows = input.follows as { type?: unknown; id?: unknown };
    const type = typeof follows.type === 'string' ? follows.type : '';
    if (
      !(AUDIENCE_FOLLOW_TYPES as readonly string[]).includes(type) ||
      typeof follows.id !== 'string' ||
      !UUID.test(follows.id)
    ) {
      invalid('filter.follows is a type (team or competition) and an id.');
    }
    filter.follows = { type: type as AudienceFollowType, id: follows.id.toLowerCase() };
  }
  if (input.country_id !== undefined && input.country_id !== null) {
    if (typeof input.country_id !== 'string' || !UUID.test(input.country_id)) {
      invalid('filter.country_id is a country id.');
    }
    filter.country_id = input.country_id.toLowerCase();
  }
  if (input.language !== undefined && input.language !== null) {
    if (typeof input.language !== 'string' || !/^[a-z]{2}(-[a-z]{2,4})?$/i.test(input.language)) {
      invalid('filter.language is a language code.');
    }
    filter.language = input.language.toLowerCase();
  }
  if (input.verified_only !== undefined) {
    if (typeof input.verified_only !== 'boolean') invalid('filter.verified_only is true or false.');
    filter.verified_only = input.verified_only;
  }
  if (input.joined_after !== undefined && input.joined_after !== null) {
    if (typeof input.joined_after !== 'string' || Number.isNaN(Date.parse(input.joined_after))) {
      invalid('filter.joined_after is a date.');
    }
    filter.joined_after = new Date(input.joined_after).toISOString();
  }
  return filter;
}

/**
 * Campaigns for administrators (T-332, D-075). Every write carries a reason
 * and lands in the audit log; nothing here is reachable without the role.
 */
@Controller()
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly identity: IdentityService,
  ) {}

  private async admin(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      throw new ForbiddenException(NOT_AN_ADMIN);
    }
    return user;
  }

  @Get('admin/audiences')
  async audiences(@Req() request: FastifyRequest): Promise<AudiencesResponse> {
    await this.admin(request);
    return { audiences: await this.campaigns.audiences() };
  }

  @Post('admin/audiences')
  @HttpCode(201)
  async createAudience(
    @Req() request: FastifyRequest,
    @Body() body: CreateAudienceRequest,
  ): Promise<Audience> {
    const user = await this.admin(request);
    return this.campaigns.createAudience({
      name: word(body?.name, 'name', 80),
      filter: filterOf(body?.filter),
      actorId: user.id,
      reason: word(body?.reason, 'reason', 300),
    });
  }

  @Get('admin/campaigns')
  async list(@Req() request: FastifyRequest): Promise<CampaignsResponse> {
    await this.admin(request);
    return { campaigns: await this.campaigns.campaigns() };
  }

  @Get('admin/campaigns/:id')
  async one(@Req() request: FastifyRequest, @Param('id') id: string): Promise<Campaign> {
    await this.admin(request);
    const campaign = UUID.test(id) ? await this.campaigns.campaign(id) : null;
    if (campaign === null) throw new NotFoundException(NO_CAMPAIGN);
    return campaign;
  }

  @Post('admin/campaigns')
  @HttpCode(201)
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreateCampaignRequest,
  ): Promise<Campaign> {
    const user = await this.admin(request);
    const audienceId = word(body?.audience_id, 'audience_id', 36).toLowerCase();
    if (!UUID.test(audienceId)) invalid('audience_id is an audience id.');
    const path = word(body?.path, 'path', 300);
    if (!path.startsWith('/') || path.startsWith('//') || /\s/.test(path)) {
      invalid('path is an in-app path, like /match/<id>.');
    }
    const created = await this.campaigns.createCampaign({
      audienceId,
      title: word(body?.title, 'title', 120),
      body: word(body?.body, 'body', 2000),
      path,
      actorId: user.id,
      reason: word(body?.reason, 'reason', 300),
    });
    if (created === 'no_audience') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such audience.',
      } satisfies ApiError);
    }
    return created;
  }

  @Post('admin/campaigns/:id/send')
  async send(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body() body: SendCampaignRequest,
  ): Promise<CampaignDispatch> {
    const user = await this.admin(request);
    const reason = word(body?.reason, 'reason', 300);
    if (!UUID.test(id)) throw new NotFoundException(NO_CAMPAIGN);
    const result = await this.campaigns.send(id, user.id, reason);
    if (result.outcome === 'no_campaign') throw new NotFoundException(NO_CAMPAIGN);
    if (result.outcome === 'already_sent') {
      throw new ConflictException({
        error: 'conflict',
        message: 'This campaign was already sent; nobody is reached twice.',
      } satisfies ApiError);
    }
    return result.dispatch;
  }
}
