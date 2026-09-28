import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NotificationKind } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * One notification to a whole audience in one statement (T-835):
 * `emitToAudience`, the set-based `emit` a match alert is written with.
 *
 * Each member below stands for one rule `emit` applies member by member --
 * the kind's default, their own switch either way, the category mute, the
 * team and competition mutes, quiet hours delaying and never dropping, the
 * dedupe key -- and the set-based insert must reach exactly the same
 * members, with the same hold, as `emit` does one at a time. The parity is
 * checked by emitting the same thing both ways.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const OTHER_COMPETITION = randomUUID();
const SEASON = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const ELSEWHERE = randomUUID();
const FIXTURE = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'emitting to an audience in one statement',
  () => {
    let pool: Pool;
    let notifications: NotificationsService;
    let close: () => Promise<void>;
    const ids = new Map<string, string>();

    async function member(label: string, timezone = 'Europe/London'): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $1, $1 || '@example.test', $2, 'en', $3, now(), now())
         RETURNING id`,
        [`au${String(ids.size)}${RUN}`, ENGLAND, timezone],
      );
      ids.set(label, rows[0]!.id);
      return rows[0]!.id;
    }

    /** Everyone, in a fixed order, as the audience. */
    const everyone = (): string[] => [...ids.values()];
    const label = (id: string): string => [...ids].find(([, v]) => v === id)?.[0] ?? id;
    const labels = (list: string[]): string[] => list.map(label).sort();

    const written = (key: string) =>
      pool
        .query<{ user_id: string; held_reason: string | null; later: boolean }>(
          `SELECT user_id, held_reason, deliver_after > now() AS later
             FROM notification WHERE dedupe_key = $1`,
          [key],
        )
        .then((r) =>
          r.rows
            .map((row) => ({ who: label(row.user_id), held: row.held_reason, later: row.later }))
            .sort((a, b) => a.who.localeCompare(b.who)),
        );

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
         VALUES ($1, $3, $4, 'league', 'domestic', 'men', 'senior', 9),
                ($2, $3, $5, 'league', 'domestic', 'men', 'senior', 9)`,
        [COMPETITION, OTHER_COMPETITION, ENGLAND, `Audience ${RUN}`, `Elsewhere ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender)
         VALUES ($1, 'Audience Home', 'club', 'men'), ($2, 'Audience Away', 'club', 'men'),
                ($3, 'Audience Elsewhere', 'club', 'men')`,
        [HOME, AWAY, ELSEWHERE],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now(), 'live')`,
        [FIXTURE, SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, NotificationsModule],
      })
        .overrideProvider(MAILER)
        .useValue(new CaptureMailer())
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .compile();
      await moduleRef.init();
      close = () => moduleRef.close();
      notifications = moduleRef.get(NotificationsService);

      await member('plain');
      await notifications.setPreference(await member('off'), 'match_goal', false);
      await notifications.setPreference(await member('redon'), 'match_red_card', true);
      await notifications.mute(await member('category'), 'category', 'match');
      await notifications.mute(await member('team'), 'team', AWAY);
      await notifications.mute(await member('competition'), 'competition', COMPETITION);
      // Mutes about something else leave this match alone.
      const unrelated = await member('unrelated');
      await notifications.mute(unrelated, 'team', ELSEWHERE);
      await notifications.mute(unrelated, 'competition', OTHER_COMPETITION);
      await notifications.mute(unrelated, 'category', 'social');
      const asleep = await member('asleep', 'Etc/UTC');
      const hour = new Date().getUTCHours();
      const hh = (h: number): string => `${String((h + 24) % 24).padStart(2, '0')}:00`;
      await notifications.setQuietHours(asleep, hh(hour - 1), hh(hour + 2));
    });

    afterAll(async () => {
      await close?.();
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`au%${RUN}`]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM team WHERE id IN ($1, $2, $3)`, [HOME, AWAY, ELSEWHERE]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id IN ($1, $2)`, [
        COMPETITION,
        OTHER_COMPETITION,
      ]);
      await pool.end();
    });

    const request = (kind: NotificationKind, dedupeKey: string) => ({
      kind,
      subjectType: 'fixture' as const,
      subjectId: FIXTURE,
      dedupeKey,
    });

    it('a kind on by default: everyone but their own "off" and their mutes; quiet hours hold', async () => {
      const key = `${FIXTURE}:goal:${RUN}`;
      const told = await notifications.emitToAudience(request('match_goal', key), everyone());
      expect(labels(told?.now ?? [])).toEqual(['plain', 'redon', 'unrelated']);
      expect(labels(told?.delayed ?? [])).toEqual(['asleep']);
      expect(await written(key)).toEqual([
        { who: 'asleep', held: 'your quiet hours', later: true },
        { who: 'plain', held: null, later: false },
        { who: 'redon', held: null, later: false },
        { who: 'unrelated', held: null, later: false },
      ]);
    });

    it('a kind off by default: only the member who switched it on', async () => {
      const key = `${FIXTURE}:red:${RUN}`;
      const told = await notifications.emitToAudience(request('match_red_card', key), everyone());
      expect(labels(told?.now ?? [])).toEqual(['redon']);
      expect(told?.delayed).toEqual([]);
    });

    it('the same key again writes nothing and tells nobody', async () => {
      const key = `${FIXTURE}:goal:${RUN}`;
      const told = await notifications.emitToAudience(request('match_goal', key), everyone());
      expect(told).toEqual({ now: [], delayed: [] });
      expect(await written(key)).toHaveLength(4);
    });

    it('reaches exactly whom emit reaches, one at a time, for every match kind', async () => {
      for (const kind of ['match_kickoff', 'match_goal', 'match_red_card'] as const) {
        const one = `${FIXTURE}:one:${kind}:${RUN}`;
        const all = `${FIXTURE}:all:${kind}:${RUN}`;
        const outcomes = await notifications.emitMany(
          everyone().map((userId) => ({ ...request(kind, one), userId })),
        );
        const byOne = {
          now: everyone().filter((_, i) => outcomes[i] === 'sent'),
          delayed: everyone().filter((_, i) => outcomes[i] === 'delayed'),
        };
        const byAll = await notifications.emitToAudience(request(kind, all), everyone());
        expect({
          kind,
          now: labels(byAll?.now ?? []),
          delayed: labels(byAll?.delayed ?? []),
        }).toEqual({ kind, now: labels(byOne.now), delayed: labels(byOne.delayed) });
      }
    });

    it('nobody, or a member who does not exist, is nothing', async () => {
      expect(await notifications.emitToAudience(request('match_goal', `${RUN}:x`), [])).toEqual({
        now: [],
        delayed: [],
      });
      const told = await notifications.emitToAudience(
        request('match_kickoff', `${FIXTURE}:k:${RUN}`),
        [randomUUID(), ids.get('plain')!],
      );
      expect(labels(told?.now ?? [])).toEqual(['plain']);
    });
  },
);
