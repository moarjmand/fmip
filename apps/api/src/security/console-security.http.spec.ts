import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, NotificationSettings, OwnProfile } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { HTTP_APP_OPTIONS } from '../http-options';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../modules/identity/identity.service';
import { CEILINGS, EXEMPT, coverageOf } from '../modules/rate-limits/inventory';
import { withTriggersOff } from '../testing/cleanup';

/**
 * Security tests for the administration console and member settings (T-813,
 * blueprint 19: "security tests cover ... administrator actions").
 *
 * **Table-driven, and the table is checked against the router.** The whole
 * application is booted and every route it registers is collected from
 * Fastify's `onRoute` hook -- the router itself, not a list someone keeps. Every
 * `/admin` route must have a row in `CONSOLE` below, and every row must be a
 * route: an administration endpoint added without a row here fails this spec
 * with its method and path, so nobody can add one to the console without
 * saying who may call it.
 *
 * For every row, and so for every page of the console:
 *
 * - a guest gets **401** `unauthenticated`, and a member without a role
 *   **403** `forbidden` (D-108);
 * - every role that is *not* in the row gets **403** `forbidden` too -- a moderator is
 *   not an editor, an editor is not an administrator;
 * - a refusal is a refusal, not data: its body is an `ApiError` and nothing
 *   else;
 * - a role that *is* in the row gets past the gate (neither 401 nor 403);
 * - a write that must say why is refused without a reason, naming it, and
 *   nothing a refused call did leaves an audit row behind; a write that asks
 *   for no reason says here why not.
 *
 * **CSRF, the same posture as the rest of the API.** The session cookie is
 * `HttpOnly; SameSite=Lax`, so a cross-site `POST` carries no session; no
 * console route changes anything on `GET` (checked: no `GET` leaves an audit
 * row); and a body a cross-site HTML form can send
 * (`application/x-www-form-urlencoded`) is refused before any handler runs.
 *
 * Outside the console, every write the router has -- any method but `GET`,
 * `HEAD` and `OPTIONS` -- refuses a guest unless it is one of the public
 * account writes listed in `PUBLIC_WRITES`, and every `/me` route refuses a
 * guest. And every member settings write (T-620, T-621 and the settings
 * pages) is tested once with **two** members: what one member's session
 * writes never reaches the other member's account.
 *
 * What each console write does when it *succeeds* -- the audit row with
 * actor, reason, previous and next -- is each module's own spec
 * (`admin.http.spec.ts`, `moderation-admin.http.spec.ts`,
 * `contributor.http.spec.ts`, ...); one representative success is repeated
 * here so the audit check is not only about refusals.
 */
const DATABASE_URL = process.env.DATABASE_URL;

type Role = 'admin' | 'moderator' | 'editor' | 'founder';
const ROLES: readonly Role[] = ['admin', 'moderator', 'editor', 'founder'];

const ADMIN: readonly Role[] = ['admin'];
const MODERATION: readonly Role[] = ['moderator', 'admin'];
const EDITORIAL: readonly Role[] = ['editor', 'admin'];

interface ConsoleRoute {
  /** Who may call it. Everyone else -- guests, members, the other roles -- is refused. */
  roles: readonly Role[];
  /**
   * For a write: `{ without }` is a body complete but for its reason, which
   * must be refused naming the reason; `{ none }` says why this write asks for
   * no reason. Omitted for a read.
   */
  reason?: { without: Record<string, unknown> } | { none: string };
}

const UUID_A = '00000000-0000-4000-8000-00000000dead';

/**
 * Every `/admin` route, by the method and path the router registers.
 * Adding a console endpoint means adding its row here, deliberately.
 */
const CONSOLE: Record<string, ConsoleRoute> = {
  // The operator's overview, members, coverage and the audit log (T-070, T-600).
  'GET /admin/overview': { roles: ADMIN },
  'GET /admin/users': { roles: ADMIN },
  'POST /admin/users/:id/status': {
    roles: ADMIN,
    reason: { without: { status: 'suspended' } },
  },
  'PUT /admin/coverage/:seasonId/:module': {
    roles: ADMIN,
    reason: { without: { state: 'not_supplied' } },
  },
  'GET /admin/audit': { roles: ADMIN },
  'POST /admin/ingestion/backfill': { roles: ADMIN, reason: { without: {} } },

  // The System page (T-801 to T-804).
  'GET /admin/health/failures': { roles: ADMIN },
  'GET /admin/health/watchdog': { roles: ADMIN },
  'GET /admin/health/alerts': { roles: ADMIN },
  'GET /admin/activity': { roles: ADMIN },
  'GET /admin/rate-limits': { roles: ADMIN },

  // Data quality (T-640).
  'GET /admin/data-quality': { roles: ADMIN },
  'POST /admin/data-quality/:id/review': { roles: ADMIN, reason: { without: {} } },
  'POST /admin/data-quality/refetch': {
    roles: ADMIN,
    reason: { without: { fixture_id: UUID_A } },
  },
  'POST /admin/data-quality/review-batch': {
    roles: ADMIN,
    reason: { without: { check: 'lineup_not_eleven', season_id: UUID_A } },
  },

  // Campaigns (T-332).
  'GET /admin/audiences': { roles: ADMIN },
  'POST /admin/audiences': {
    roles: ADMIN,
    reason: { without: { name: 'Security probe', filter: {} } },
  },
  'GET /admin/campaigns': { roles: ADMIN },
  'GET /admin/campaigns/:id': { roles: ADMIN },
  'POST /admin/campaigns': {
    roles: ADMIN,
    reason: {
      without: { audience_id: UUID_A, path: '/en/scores', title: 'Probe', body: 'Probe' },
    },
  },
  'POST /admin/campaigns/:id/send': { roles: ADMIN, reason: { without: {} } },

  // Moderation (T-212, T-441, T-610, T-611).
  'GET /admin/moderation/queue': { roles: MODERATION },
  'GET /admin/moderation/members/:username': { roles: MODERATION },
  'POST /admin/moderation/decisions': {
    roles: MODERATION,
    reason: { without: { report_ids: [UUID_A], outcome: 'no_action' } },
  },
  'POST /admin/moderation/sanctions/:id/lift': {
    roles: MODERATION,
    reason: { without: {} },
  },
  'POST /admin/moderation/reports/:id/suggest': {
    roles: MODERATION,
    reason: {
      none: 'Asks the assistant for a suggestion on a report; it decides nothing and changes no member.',
    },
  },

  // Contributors (T-250, T-612).
  'GET /admin/contributors': { roles: MODERATION },
  'GET /admin/contributors/:username': { roles: MODERATION },
  'POST /admin/contributors': { roles: MODERATION, reason: { without: {} } },
  'POST /admin/contributors/:username/pause': {
    roles: MODERATION,
    reason: { without: {} },
  },
  'POST /admin/contributors/:username/resume': {
    roles: MODERATION,
    reason: { without: {} },
  },
  'POST /admin/contributors/:username/withdraw': {
    roles: MODERATION,
    reason: { without: {} },
  },

  // Featured-match panels (T-253, T-613).
  'GET /admin/panels': { roles: MODERATION },
  'POST /admin/fixtures/:id/panel': { roles: MODERATION, reason: { without: {} } },
  'POST /admin/fixtures/:id/panel/close': {
    roles: MODERATION,
    reason: { without: {} },
  },

  // Editorial: analysis reviews, debates, translations, viewing, summaries.
  'GET /admin/analysis-reviews': { roles: EDITORIAL },
  'POST /admin/analysis-reviews/:submissionId': {
    roles: EDITORIAL,
    reason: { without: { decision: 'approved' } },
  },
  'GET /admin/debates': { roles: EDITORIAL },
  'POST /admin/stories/:id/debate': { roles: EDITORIAL, reason: { without: {} } },
  'POST /admin/stories/:id/debate/clear': {
    roles: EDITORIAL,
    reason: { without: {} },
  },
  'POST /admin/stories/:id/type': {
    roles: EDITORIAL,
    reason: { without: { type: 'transfer' } },
  },
  'POST /admin/articles/:id/translations': {
    roles: EDITORIAL,
    reason: {
      none: 'Adds a translation, which is content under its translator, audited with who and when; nothing is overridden.',
    },
  },
  'POST /admin/articles/:id/translations/:language/review': {
    roles: EDITORIAL,
    reason: {
      none: "A reviewer's approval of a translation is the decision itself, audited with who and when.",
    },
  },
  'GET /admin/viewing/broadcasters': { roles: EDITORIAL },
  'POST /admin/viewing/broadcasters': {
    roles: EDITORIAL,
    reason: { none: 'Adds a broadcaster to the directory; removals carry a reason (T-312).' },
  },
  'GET /admin/viewing/coverage': { roles: EDITORIAL },
  'PUT /admin/viewing/coverage': {
    roles: EDITORIAL,
    reason: {
      none: 'Records where a broadcaster shows a season; removals carry a reason (T-312).',
    },
  },
  'POST /admin/fixtures/:id/viewing-options': {
    roles: EDITORIAL,
    reason: { none: 'Adds a way to watch a match; its removal carries a reason (T-312).' },
  },
  'POST /admin/fixtures/:id/viewing-options/:optionId/remove': {
    roles: EDITORIAL,
    reason: { without: {} },
  },
  'PUT /admin/fixtures/:id/highlight': {
    roles: EDITORIAL,
    reason: {
      none: 'Adds a highlight link for a territory; its removal carries a reason (T-312).',
    },
  },
  'POST /admin/fixtures/:id/highlight/:territory/remove': {
    roles: EDITORIAL,
    reason: { without: {} },
  },
  'POST /admin/fixtures/:id/summary': { roles: EDITORIAL, reason: { without: {} } },
};

/**
 * Role-gated writes outside `/admin`. Only the refusals are exercised: with
 * the role, each of these does real work across the shared test database
 * (settling fixtures, recomputing every rating, calling the model), which is
 * each module's own spec to do.
 */
const GATED_ELSEWHERE: Record<string, { roles: readonly Role[] }> = {
  'POST /fixtures/:fixtureId/forecasts': { roles: ADMIN },
  'POST /fixtures/:fixtureId/power-index': { roles: ADMIN },
  'POST /fixtures/:fixtureId/evaluations': { roles: ADMIN },
  'POST /fixtures/:fixtureId/settle': { roles: ADMIN },
  'POST /settlements/run': { roles: ADMIN },
  'POST /ratings/recompute': { roles: ADMIN },
  'POST /fixtures/:fixtureId/founder-analysis': { roles: ['founder'] },
};

/** The only writes a guest may make: getting into, and out of, an account. */
const PUBLIC_WRITES = new Set([
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/verify-email',
  'POST /auth/password/forgot',
  'POST /auth/password/reset',
]);

/** A 403 is `forbidden`, carrying a sentence and nothing else (D-108). */
function expectForbidden(who: string, response: { statusCode: number; body: string }): void {
  expect(response.statusCode, `${who}: ${response.body}`).toBe(403);
  const error = JSON.parse(response.body) as ApiError;
  expect(Object.keys(error).sort()).toEqual(['error', 'message']);
  expect(error.error, `${who}: ${response.body}`).toBe('forbidden');
}

/** `'POST /admin/x'` → its method and path. */
function parts(route: string): { method: string; path: string } {
  const [method = '', path = ''] = route.split(' ');
  return { method, path };
}

/** A path with its parameters filled by values that name nothing real. */
function concrete(path: string): string {
  return path
    .replace(/:username/g, 'nobody_t813')
    .replace(/:territory/g, 'GB')
    .replace(/:language/g, 'fa')
    .replace(/:module/g, 'scores')
    .replace(/:scope/g, 'category')
    .replace(/:target/g, 'social')
    .replace(/:kind/g, 'friend_request')
    .replace(/:type/g, 'team')
    .replace(/:slug/g, 'no-such-group-t813')
    .replace(/:reaction/g, 'like')
    .replace(/:[A-Za-z]+/g, UUID_A);
}

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PASSWORD = 'correct horse battery staple';

type Who = 'member' | 'other' | 'target' | 'prober' | Role;
interface Account {
  id: string;
  username: string;
  cookie: string;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the console and member settings refuse whoever is not entitled (T-813)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const routes = new Set<string>();
    const accounts = {} as Record<Who, Account>;
    let loginSetCookie = '';

    const inject = (
      method: string,
      url: string,
      who?: Who,
      payload?: unknown,
      headers: Record<string, string> = {},
    ) =>
      app.inject({
        method: method as 'GET',
        url,
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        headers: {
          ...headers,
          ...(who === undefined ? {} : { cookie: `fmip_session=${accounts[who].cookie}` }),
        },
      });

    const auditRows = async (): Promise<number> => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE actor_id = ANY($1::uuid[])`,
        [Object.values(accounts).map((a) => a.id)],
      );
      return Number(rows[0]?.n);
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .compile();
      // Created exactly as main.ts creates it, or the CSRF checks below would
      // test a different server.
      app = moduleRef.createNestApplication<NestFastifyApplication>(
        new FastifyAdapter(),
        HTTP_APP_OPTIONS,
      );
      // The router as Fastify builds it: every route every controller declares.
      app
        .getHttpAdapter()
        .getInstance()
        .addHook('onRoute', (route) => {
          for (const method of [route.method].flat()) routes.add(`${method} ${route.url}`);
        });
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      for (const who of ['member', 'other', 'target', 'prober', ...ROLES] as Who[]) {
        const username = `sec_${RUN}_${who.slice(0, 3)}`;
        const registered = await inject('POST', '/auth/register', undefined, {
          username,
          display_name: `Security ${who}`,
          email: `${username}@example.test`,
          password: PASSWORD,
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        });
        expect(registered.statusCode, registered.body).toBe(201);
        const setCookie = [registered.headers['set-cookie']].flat()[0] ?? '';
        accounts[who] = {
          id: (registered.json() as { user: { id: string } }).user.id,
          username,
          cookie: /^fmip_session=([^;]*)/.exec(setCookie)?.[1] ?? '',
        };
      }
      for (const role of ROLES) {
        await pool.query(
          `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, $2, $1, 'T-813 security test')`,
          [accounts[role].id, role],
        );
      }
      const login = await inject('POST', '/auth/login', undefined, {
        identifier: accounts.member.username,
        password: PASSWORD,
      });
      loginSetCookie = String([login.headers['set-cookie']].flat()[0] ?? '');
      // The whole application boots here, and seven accounts are registered
      // (each a scrypt hash): more than the default ten seconds on a busy runner.
    }, 60_000);

    afterAll(async () => {
      // Close the application first: nothing may still be using the pool below.
      if (app !== undefined) await app.close();
      if (pool !== undefined) {
        const ids = Object.values(accounts).map((a) => a.id);
        // audit_log is immutable, and its actor is restricted: the one audited
        // success below goes first, with the guard off for this session only.
        await withTriggersOff(pool, async (client) => {
          await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [ids]);
        });
        await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
        await pool.end();
      }
    });

    const adminRoutes = () => [...routes].filter((r) => parts(r).path.startsWith('/admin'));
    const isWrite = (route: string) => !/^(GET|HEAD|OPTIONS) /.test(route);

    describe('the table is the router', () => {
      it('has a row for every /admin route, so a new console endpoint cannot ship untested', () => {
        const missing = adminRoutes().filter((r) => !r.startsWith('HEAD ') && !(r in CONSOLE));
        expect(
          missing,
          'console routes with no row in CONSOLE: add each, with who may call it',
        ).toEqual([]);
      });

      it('has no row for a route that no longer exists', () => {
        const gone = [...Object.keys(CONSOLE), ...Object.keys(GATED_ELSEWHERE)].filter(
          (r) => !routes.has(r),
        );
        expect(gone, 'rows naming routes the router does not have').toEqual([]);
      });
    });

    describe.each(Object.entries(CONSOLE))('%s', (route, row) => {
      const { method, path } = parts(route);
      const url = concrete(path);
      const body = method === 'GET' ? undefined : {};

      it('refuses a guest with 401 unauthenticated and a member without the role with 403 forbidden, saying only that', async () => {
        const guest = await inject(method, url, undefined, body);
        expect(guest.statusCode, guest.body).toBe(401);
        const error = guest.json() as ApiError;
        expect(Object.keys(error).sort()).toEqual(['error', 'message']);
        expect(error.error).toBe('unauthenticated');
        expectForbidden('member', await inject(method, url, 'member', body));
      });

      it(`is refused (403 forbidden) to every role but ${row.roles.join(' and ')}`, async () => {
        for (const role of ROLES.filter((r) => !row.roles.includes(r)))
          expectForbidden(role, await inject(method, url, role, body));
      });

      it(`lets ${row.roles.join(' and ')} past the gate`, async () => {
        for (const role of row.roles) {
          const payload =
            row.reason !== undefined && 'without' in row.reason ? row.reason.without : body;
          const response = await inject(method, url, role, payload);
          expect([401, 403], `${role}: ${response.body}`).not.toContain(response.statusCode);
          expect(response.statusCode, `${role}: ${response.body}`).toBeLessThan(500);
          // Every probe of a write here is incomplete, so none may succeed.
          if (method !== 'GET')
            expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
        }
      });

      if (row.reason !== undefined && 'without' in row.reason) {
        const without = row.reason.without;
        it('refuses the write without a reason, naming it', async () => {
          const response = await inject(method, url, row.roles[0], without);
          expect(response.statusCode, response.body).toBe(400);
          const error = response.json() as ApiError & { fields?: Record<string, string> };
          const named = error.fields?.reason !== undefined || /reason|why/i.test(error.message);
          expect(named, `the refusal names the missing reason: ${response.body}`).toBe(true);
        });
      }

      if (method !== 'GET') {
        it('refuses a body a cross-site form can send, before any handler runs', async () => {
          const response = await inject(method, url, row.roles[0], 'reason=because', {
            'content-type': 'application/x-www-form-urlencoded',
          });
          expect(response.statusCode, response.body).toBe(415);
        });
      }
    });

    describe('audit', () => {
      it('no refused call and no read above left an audit row', async () => {
        // Vitest runs a file's tests in order: by now every row's refusals and
        // gate probes have run, as every role.
        expect(await auditRows()).toBe(0);
      });

      it('a console write that succeeds writes its audit row, with actor, reason, previous and next', async () => {
        const response = await inject(
          'POST',
          `/admin/users/${accounts.target.id}/status`,
          'admin',
          { status: 'suspended', reason: 'T-813: the audited path' },
        );
        expect(response.statusCode, response.body).toBe(200);
        const { rows } = await pool.query<{
          actor_id: string;
          action: string;
          target_id: string;
          reason: string;
          previous: unknown;
          next: unknown;
        }>(
          `SELECT actor_id, action, target_id, reason, previous, next FROM audit_log WHERE actor_id = $1`,
          [accounts.admin.id],
        );
        expect(rows).toEqual([
          {
            actor_id: accounts.admin.id,
            action: 'user.status',
            target_id: accounts.target.id,
            reason: 'T-813: the audited path',
            previous: expect.anything(),
            next: expect.anything(),
          },
        ]);
      });

      it('cannot be written without a reason, whatever the code does', async () => {
        await expect(
          pool.query(
            `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason) VALUES ($1, 'probe.check', 'user', $2, '  ')`,
            [accounts.admin.id, accounts.admin.id],
          ),
        ).rejects.toThrow(/audit_log_reason_not_blank/);
      });
    });

    describe.each(Object.entries(GATED_ELSEWHERE))('%s', (route, row) => {
      const { method, path } = parts(route);
      const url = concrete(path);

      it(`refuses a guest (401), a member and every role but ${row.roles.join(', ')} (403 forbidden)`, async () => {
        expect((await inject(method, url, undefined, {})).statusCode).toBe(401);
        expectForbidden('member', await inject(method, url, 'member', {}));
        for (const role of ROLES.filter((r) => !row.roles.includes(r)))
          expectForbidden(role, await inject(method, url, role, {}));
      });
    });

    describe('outside the console', () => {
      it('every write refuses a guest, except getting into and out of an account', async () => {
        const accepted: string[] = [];
        for (const route of [...routes].filter(isWrite)) {
          if (PUBLIC_WRITES.has(route) || parts(route).path.startsWith('/admin')) continue;
          const { method, path } = parts(route);
          const response = await inject(method, concrete(path), undefined, {});
          if (response.statusCode !== 401) accepted.push(`${route} -> ${response.statusCode}`);
        }
        expect(accepted, 'writes a guest was not refused (401) by').toEqual([]);
      });

      it('every public write in the list is still a route', () => {
        expect([...PUBLIC_WRITES].filter((r) => !routes.has(r))).toEqual([]);
      });

      it('every /me route refuses a guest', async () => {
        const accepted: string[] = [];
        for (const route of [...routes].filter((r) => / \/me(\/|$)/.test(r))) {
          const { method, path } = parts(route);
          if (method === 'HEAD' || method === 'OPTIONS') continue;
          // The chat socket upgrades rather than answers; a plain GET without
          // a session is still refused, which is what this checks.
          const response = await inject(
            method,
            concrete(path),
            undefined,
            method === 'GET' ? undefined : {},
          );
          if (response.statusCode !== 401) accepted.push(`${route} -> ${response.statusCode}`);
        }
        expect(accepted, '/me routes a guest was not refused (401) by').toEqual([]);
      });

      it('the session cookie is HttpOnly and SameSite=Lax, so a cross-site POST carries no session', () => {
        expect(loginSetCookie).toMatch(/^fmip_session=/);
        expect(loginSetCookie).toMatch(/;\s*HttpOnly/);
        expect(loginSetCookie).toMatch(/;\s*SameSite=Lax/);
      });
    });

    /**
     * The rate-limit inventory (T-811, D-103), held to the same router: a
     * write added without a ceiling and without a reason it needs none fails
     * here with its method and path, and so does an entry for a route that
     * is gone. The ceilings named must be rows in `rate_limit` (a missing row
     * means "not limited", so a typo would silently lift a limit), and every
     * trigger that enforces one must name a ceiling the inventory lists.
     */
    describe('every write has a ceiling or a stated reason for none', () => {
      it('the inventory covers every write the router has', () => {
        const missing = [...routes].filter(isWrite).filter((r) => coverageOf(r).kind === 'missing');
        expect(missing, 'writes with neither a ceiling nor an exemption in inventory.ts').toEqual(
          [],
        );
      });

      it('every route the inventory names is still a route the router has, and every exemption a write', () => {
        // A ceiling may hold a read whose work is a model call (`GET /ask`,
        // T-838); an exemption is only ever a write's.
        const limited = CEILINGS.flatMap((c) => c.routes);
        expect(limited.filter((r) => !routes.has(r))).toEqual([]);
        expect(Object.keys(EXEMPT).filter((r) => !routes.has(r) || !isWrite(r))).toEqual([]);
      });

      it('no route is both limited and exempt, and every exemption says why', () => {
        const limited = new Set(CEILINGS.flatMap((c) => c.routes));
        expect(Object.keys(EXEMPT).filter((r) => limited.has(r))).toEqual([]);
        expect(Object.entries(EXEMPT).filter(([, why]) => why.trim().length < 20)).toEqual([]);
      });

      it('every ceiling the inventory names is a row in rate_limit, and every row is named', async () => {
        const { rows } = await pool.query<{ action: string }>(`SELECT action FROM rate_limit`);
        const table = new Set(rows.map((r) => r.action));
        const named = new Set(CEILINGS.map((c) => c.action));
        expect([...named].filter((a) => !table.has(a))).toEqual([]);
        expect([...table].filter((a) => !named.has(a))).toEqual([]);
      });

      it('every trigger that enforces a ceiling enforces one the inventory lists as a trigger ceiling', async () => {
        // tgargs is the trigger's arguments, each ended by a NUL, which
        // encode(..., 'escape') writes as the four characters \000.
        const { rows } = await pool.query<{ action: string }>(
          `SELECT split_part(encode(t.tgargs, 'escape'), '\\000', 1) AS action
             FROM pg_trigger t
            WHERE t.tgfoid = 'refuse_over_rate'::regproc AND NOT t.tgisinternal`,
        );
        const database = new Set(
          CEILINGS.filter((c) => c.enforced === 'database').map((c) => c.action),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((r) => r.action).filter((a) => !database.has(a))).toEqual([]);
      });
    });

    /**
     * Member settings: each write once. `member` is the account under test and
     * keeps a known state; `other` writes with its own session, the way any
     * member could, and the member's state must not move. Every settings route
     * is `/me/...` -- none takes another member's id -- so this is the proof
     * that the session, and only the session, decides whose settings change.
     */
    describe('a settings write reaches only the account whose session made it', () => {
      const own = async (who: Who) =>
        (await inject('GET', '/me/profile', who)).json() as OwnProfile;
      const settings = async (who: Who) =>
        (await inject('GET', '/me/notification-settings', who)).json() as NotificationSettings;

      it('PATCH /me/profile', async () => {
        const before = await own('member');
        const response = await inject('PATCH', '/me/profile', 'other', {
          display_name: 'Changed by another',
          bio: 'Not the member',
        });
        expect(response.statusCode, response.body).toBe(200);
        expect((response.json() as OwnProfile).profile.display_name).toBe('Changed by another');
        expect((await own('member')).profile).toEqual(before.profile);
      });

      it('PATCH /me/preferences (language, time zone, theme, text size, contrast, motion)', async () => {
        const before = await own('member');
        const response = await inject('PATCH', '/me/preferences', 'other', {
          preferred_language: 'fa',
          timezone: 'Asia/Tehran',
          theme: before.theme === 'dark' ? 'light' : 'dark',
          text_size: before.text_size === 'larger' ? 'default' : 'larger',
          contrast: before.contrast === 'more' ? 'standard' : 'more',
          motion: before.motion === 'reduce' ? 'system' : 'reduce',
        });
        expect(response.statusCode, response.body).toBe(200);
        const after = await own('member');
        for (const key of ['theme', 'text_size', 'contrast', 'motion'] as const)
          expect(after[key]).toBe(before[key]);
        expect(after.account).toEqual(before.account);
      });

      it('PATCH /me/privacy', async () => {
        const before = await own('member');
        const response = await inject('PATCH', '/me/privacy', 'other', {
          profile_visibility:
            before.privacy.profile_visibility === 'private' ? 'public' : 'private',
        });
        expect(response.statusCode, response.body).toBe(200);
        expect((await own('member')).privacy).toEqual(before.privacy);
      });

      it('PUT /me/territory', async () => {
        const territories = (
          (await inject('GET', '/territories')).json() as { territories: { code: string }[] }
        ).territories;
        expect(territories.length).toBeGreaterThan(0);
        const before = (await inject('GET', '/me/territory', 'member')).json() as unknown;
        const response = await inject('PUT', '/me/territory', 'other', {
          code: territories[0]?.code,
        });
        expect(response.statusCode, response.body).toBe(200);
        expect((await inject('GET', '/me/territory', 'member')).json()).toEqual(before);
      });

      it('PUT /me/first-run', async () => {
        const before = (await inject('GET', '/me/first-run', 'member')).json() as unknown;
        const response = await inject('PUT', '/me/first-run', 'other');
        expect(response.statusCode, response.body).toBe(200);
        expect((await inject('GET', '/me/first-run', 'member')).json()).toEqual(before);
      });

      it('PUT /me/notification-settings/:kind', async () => {
        const before = await settings('member');
        const current = before.preferences.find((p) => p.kind === 'friend_request');
        const response = await inject('PUT', '/me/notification-settings/friend_request', 'other', {
          in_product: !(current?.in_product ?? true),
        });
        expect(response.statusCode, response.body).toBe(204);
        expect((await settings('member')).preferences).toEqual(before.preferences);
      });

      it('PUT /me/quiet-hours', async () => {
        const before = await settings('member');
        const response = await inject('PUT', '/me/quiet-hours', 'other', {
          starts_at: '22:00',
          ends_at: '07:00',
        });
        expect(response.statusCode, response.body).toBe(204);
        expect((await settings('member')).quiet_hours).toEqual(before.quiet_hours);
      });

      it('DELETE /me/quiet-hours', async () => {
        const set = await inject('PUT', '/me/quiet-hours', 'member', {
          starts_at: '23:00',
          ends_at: '06:30',
        });
        expect(set.statusCode, set.body).toBe(204);
        const before = await settings('member');
        expect(before.quiet_hours).not.toBeNull();
        const response = await inject('DELETE', '/me/quiet-hours', 'other');
        expect(response.statusCode, response.body).toBe(204);
        expect((await settings('member')).quiet_hours).toEqual(before.quiet_hours);
      });

      it('PUT /me/notification-mutes/:scope/:target', async () => {
        const before = await settings('member');
        const response = await inject('PUT', '/me/notification-mutes/category/social', 'other');
        expect(response.statusCode, response.body).toBe(204);
        expect((await settings('member')).mutes).toEqual(before.mutes);
        expect((await settings('other')).mutes.map((m) => m.target)).toContain('social');
      });

      it('DELETE /me/notification-mutes/:scope/:target', async () => {
        const set = await inject('PUT', '/me/notification-mutes/category/match', 'member');
        expect(set.statusCode, set.body).toBe(204);
        const before = await settings('member');
        // The other member has no such mute, and cannot lift the member's.
        const response = await inject('DELETE', '/me/notification-mutes/category/match', 'other');
        expect(response.statusCode, response.body).toBe(404);
        expect((await settings('member')).mutes).toEqual(before.mutes);
      });

      const device = (n: string) => ({
        endpoint: `https://push.example.test/t813/${RUN}/${n}`,
        keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
      });
      const devices = async (who: Who) =>
        ((await inject('GET', '/me/push', who)).json() as { devices: number }).devices;

      it('POST /me/push-subscriptions', async () => {
        const mine = await inject('POST', '/me/push-subscriptions', 'member', device('member'));
        expect(mine.statusCode, mine.body).toBe(204);
        const before = await devices('member');
        const response = await inject('POST', '/me/push-subscriptions', 'other', device('other'));
        expect(response.statusCode, response.body).toBe(204);
        expect(await devices('member')).toBe(before);
      });

      it('DELETE /me/push-subscriptions', async () => {
        const before = await devices('member');
        expect(before).toBeGreaterThan(0);
        // Naming the member's device from another session removes nothing.
        const response = await inject('DELETE', '/me/push-subscriptions', 'other', {
          endpoint: device('member').endpoint,
        });
        expect(response.statusCode, response.body).toBe(404);
        expect(await devices('member')).toBe(before);
      });

      it('POST /auth/account/delete', async () => {
        // Another session cannot delete the member: not by naming them, and
        // not with their password either -- the session decides whose account
        // it is, and the password and the name must both be that account's.
        for (const payload of [
          { password: PASSWORD, confirm: accounts.member.username },
          { password: 'not the password', confirm: accounts.member.username },
        ]) {
          const response = await inject('POST', '/auth/account/delete', 'other', payload);
          expect(response.statusCode, response.body).toBe(400);
        }
        const me = await inject('GET', '/auth/me', 'member');
        expect(me.statusCode).toBe(200);
        const { rows } = await pool.query<{ status: string }>(
          `SELECT status FROM user_account WHERE id = $1`,
          [accounts.member.id],
        );
        expect(rows[0]?.status).toBe('active');
      });
    });

    /**
     * T-907 (D-108): the whole router, as a member with no role. Every route
     * but getting into and out of an account is called with an empty body by
     * an account of its own (`prober`, so nothing it changes reaches the
     * accounts above), and any 403 that comes back must be `forbidden`, or
     * `email_unverified` for an account not yet verified. The refusals a
     * probe cannot reach are held to the same rule in `forbidden-code.spec.ts`.
     */
    describe('every 403 the router answers is forbidden', () => {
      it('as a member with no role, on every route', async () => {
        const wrong: string[] = [];
        let refused = 0;
        for (const route of routes) {
          const { method, path } = parts(route);
          if (method === 'HEAD' || method === 'OPTIONS' || PUBLIC_WRITES.has(route)) continue;
          // A live stream answers 200 and stays open; it refuses nobody signed in.
          if (path.endsWith('/stream')) continue;
          const response = await inject(
            method,
            concrete(path),
            'prober',
            method === 'GET' ? undefined : {},
          );
          if (response.statusCode !== 403) continue;
          refused += 1;
          const code = (JSON.parse(response.body) as ApiError).error;
          if (code !== 'forbidden' && code !== 'email_unverified')
            wrong.push(`${route} -> ${response.body}`);
        }
        // Not vacuous: every /admin route alone refuses this member.
        expect(refused).toBeGreaterThan(Object.keys(CONSOLE).length);
        expect(wrong, '403s with another code: answer forbidden (D-108)').toEqual([]);
      }, 300_000);
    });
  },
);
