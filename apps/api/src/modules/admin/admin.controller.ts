import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AdminOverview,
  type AdminUsersResponse,
  type ApiError,
  type AuditResponse,
  COVERAGE_STATES,
  type CoverageState,
  type SetCoverageRequest,
  type SetUserStatusRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { AdminService } from './admin.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVERAGE_MODULES = [
  'scores',
  'incidents',
  'lineups',
  'statistics',
  'standings',
  'availability',
  'advanced_statistics',
] as const;
const PROVIDERS = ['api_football', 'football_data_org', 'highlightly'] as const;
const REASON_MAX = 500;

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(fields: Record<string, string>): never {
  const error: ApiError = { error: 'validation', message: 'The request is not valid.', fields };
  throw new BadRequestException(error);
}

/** A non-blank reason of bounded length: every high-impact action needs one (rule 10). */
function reasonOf(body: Record<string, unknown>, fields: Record<string, string>): string {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason === '') fields.reason = 'Say why. Every administrative change records its reason.';
  else if (reason.length > REASON_MAX) fields.reason = `At most ${REASON_MAX} characters.`;
  return reason;
}

/** `/admin/...` (T-070): the operator's view and the audited writes. Admin role only. */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly identity: IdentityService,
  ) {}

  @Get('overview')
  async overview(@Req() request: FastifyRequest): Promise<AdminOverview> {
    await this.administrator(request);
    return this.admin.overview();
  }

  @Get('users')
  async users(@Query('q') q: unknown, @Req() request: FastifyRequest): Promise<AdminUsersResponse> {
    await this.administrator(request);
    const raw = Array.isArray(q) ? q[0] : q;
    const query = typeof raw === 'string' ? raw.trim() : '';
    if (query.length < 2) invalid({ q: 'Type at least 2 characters.' });
    return { query, users: await this.admin.searchUsers(query) };
  }

  @Post('users/:id/status')
  @HttpCode(200)
  async setUserStatus(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ previous: string; next: string; audit_id: string }> {
    const actor = await this.administrator(request);
    if (!UUID.test(id))
      throw new NotFoundException({ error: 'not_found', message: 'No such member.' });
    const raw = isRecord(body) ? body : {};
    const fields: Record<string, string> = {};
    const status = raw.status;
    if (status !== 'active' && status !== 'suspended')
      fields.status = 'Must be active or suspended.';
    const reason = reasonOf(raw, fields);
    if (Object.keys(fields).length > 0) invalid(fields);
    if (id.toLowerCase() === actor.id)
      invalid({ status: 'An administrator cannot change their own account status.' });
    const request_ = { status, reason } as SetUserStatusRequest;
    const outcome = await this.admin.setUserStatus(
      actor.id,
      id.toLowerCase(),
      request_.status,
      request_.reason,
    );
    if (outcome === null)
      throw new NotFoundException({ error: 'not_found', message: 'No such member.' });
    return { previous: outcome.previous, next: outcome.next, audit_id: outcome.auditId };
  }

  @Put('coverage/:seasonId/:module')
  async setCoverage(
    @Param('seasonId') seasonId: string,
    @Param('module') module: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ audit_id: string }> {
    const actor = await this.administrator(request);
    if (!UUID.test(seasonId))
      throw new NotFoundException({ error: 'not_found', message: 'No such season.' });
    const fields: Record<string, string> = {};
    if (!(COVERAGE_MODULES as readonly string[]).includes(module))
      fields.module = `Must be one of ${COVERAGE_MODULES.join(', ')}.`;
    const raw = isRecord(body) ? body : {};
    const state = raw.state;
    if (typeof state !== 'string' || !(COVERAGE_STATES as readonly string[]).includes(state))
      fields.state = `Must be one of ${COVERAGE_STATES.join(', ')}.`;
    const provider =
      raw.provider === undefined || raw.provider === null || raw.provider === ''
        ? null
        : raw.provider;
    if (
      provider !== null &&
      (typeof provider !== 'string' || !(PROVIDERS as readonly string[]).includes(provider))
    )
      fields.provider = `Must be one of ${PROVIDERS.join(', ')}, or empty.`;
    if (provider === null && (state === 'available' || state === 'limited' || state === 'delayed'))
      fields.provider = 'Data that is available, limited or delayed came from a provider: name it.';
    const note = raw.note === undefined || raw.note === null ? null : String(raw.note).trim();
    if (note !== null && note.length > REASON_MAX)
      fields.note = `At most ${REASON_MAX} characters.`;
    const reason = reasonOf(raw, fields);
    if (Object.keys(fields).length > 0) invalid(fields);
    const request_: SetCoverageRequest = {
      state: state as CoverageState,
      provider: provider as string | null,
      note: note === '' ? null : note,
      reason,
    };
    const outcome = await this.admin.setCoverage(
      actor.id,
      seasonId.toLowerCase(),
      module,
      { state: request_.state, provider: request_.provider ?? null, note: request_.note ?? null },
      request_.reason,
    );
    if (outcome === null)
      throw new NotFoundException({ error: 'not_found', message: 'No such season.' });
    return { audit_id: outcome.auditId };
  }

  @Get('audit')
  async audit(
    @Query('limit') limit: unknown,
    @Req() request: FastifyRequest,
  ): Promise<AuditResponse> {
    await this.administrator(request);
    const raw = Array.isArray(limit) ? limit[0] : limit;
    const n = typeof raw === 'string' && /^\d{1,3}$/.test(raw) ? Number(raw) : undefined;
    if (n !== undefined && (n < 1 || n > 200))
      invalid({ limit: 'Must be a whole number from 1 to 200.' });
    return { records: await this.admin.audit(n) };
  }

  private async administrator(request: FastifyRequest) {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    return user;
  }
}
