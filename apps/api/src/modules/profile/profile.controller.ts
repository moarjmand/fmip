import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type ApiError,
  FOLLOWED_ENTITY_TYPES,
  type FavouriteIds,
  type FollowedEntityType,
  type FollowingResponse,
  type OwnProfile,
  type ProfileView,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import {
  type Validated,
  validateFollow,
  validateUpdatePrivacy,
  validateUpdateProfile,
} from './internal/validation';
import { ProfileService } from './profile.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such member.' };
const UNKNOWN_ENTITY: ApiError = {
  error: 'not_found',
  message: 'No such team, competition or person.',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unwrap<T>(validated: Validated<T>): T {
  if (validated.ok) return validated.value;
  const body: ApiError = {
    error: 'validation',
    message: 'The request is not valid.',
    fields: validated.fields,
  };
  throw new BadRequestException(body);
}

function followTarget(type: string, id: string): { type: FollowedEntityType; id: string } {
  const fields: Record<string, string> = {};
  if (!(FOLLOWED_ENTITY_TYPES as readonly string[]).includes(type)) {
    fields.entity_type = `must be one of ${FOLLOWED_ENTITY_TYPES.join(', ')}`;
  }
  if (!UUID.test(id)) fields.entity_id = 'must be an id';
  if (Object.keys(fields).length > 0) {
    const body: ApiError = { error: 'validation', message: 'The request is not valid.', fields };
    throw new BadRequestException(body);
  }
  return { type: type as FollowedEntityType, id: id.toLowerCase() };
}

@Controller()
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly identity: IdentityService,
  ) {}

  private viewerId(request: FastifyRequest): Promise<string | null> {
    return this.identity
      .authenticate(parseCookies(request.headers.cookie)[SESSION_COOKIE])
      .then((user) => user?.id ?? null);
  }

  private async requireViewer(request: FastifyRequest): Promise<string> {
    const id = await this.viewerId(request);
    if (id === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return id;
  }

  /** Public, privacy applied to the viewer (signed in or not). */
  @Get('profiles/:username')
  async view(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<ProfileView> {
    const view = await this.profiles.view(username, await this.viewerId(request));
    if (view === null) throw new NotFoundException(NOT_FOUND);
    return view;
  }

  @Get('me/profile')
  async own(@Req() request: FastifyRequest): Promise<OwnProfile> {
    const own = await this.profiles.own(await this.requireViewer(request));
    if (own === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return own;
  }

  @Patch('me/profile')
  async updateProfile(@Body() body: unknown, @Req() request: FastifyRequest): Promise<OwnProfile> {
    const userId = await this.requireViewer(request);
    const own = await this.profiles.updateProfile(userId, unwrap(validateUpdateProfile(body)));
    if (own === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return own;
  }

  @Patch('me/privacy')
  async updatePrivacy(@Body() body: unknown, @Req() request: FastifyRequest): Promise<OwnProfile> {
    const userId = await this.requireViewer(request);
    const own = await this.profiles.updatePrivacy(userId, unwrap(validateUpdatePrivacy(body)));
    if (own === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return own;
  }

  // --- following (T-042) --------------------------------------------------

  @Get('me/following')
  async following(@Req() request: FastifyRequest): Promise<FollowingResponse> {
    return { items: await this.profiles.listFollowing(await this.requireViewer(request)) };
  }

  @Get('me/favourites')
  async favourites(@Req() request: FastifyRequest): Promise<FavouriteIds> {
    return this.profiles.favouriteIds(await this.requireViewer(request));
  }

  @Put('me/following/:type/:id')
  async follow(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<FollowingResponse> {
    const userId = await this.requireViewer(request);
    const target = followTarget(type, id);
    const { favourite } = unwrap(validateFollow(body));

    const outcome = await this.profiles.follow(userId, target.type, target.id, favourite);
    if (outcome === 'unknown_entity') throw new NotFoundException(UNKNOWN_ENTITY);

    return { items: await this.profiles.listFollowing(userId) };
  }

  @Delete('me/following/:type/:id')
  @HttpCode(200)
  async unfollow(
    @Param('type') type: string,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<FollowingResponse> {
    const userId = await this.requireViewer(request);
    const target = followTarget(type, id);
    await this.profiles.unfollow(userId, target.type, target.id);
    return { items: await this.profiles.listFollowing(userId) };
  }
}
