import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, OwnProfile, ProfileView } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import {
  type Validated,
  validateUpdatePrivacy,
  validateUpdateProfile,
} from './internal/validation';
import { ProfileService } from './profile.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such member.' };

function unwrap<T>(validated: Validated<T>): T {
  if (validated.ok) return validated.value;
  const body: ApiError = {
    error: 'validation',
    message: 'The request is not valid.',
    fields: validated.fields,
  };
  throw new BadRequestException(body);
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
}
