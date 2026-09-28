import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The System page keeps four promises (T-804).
 *
 * **"Nothing recorded" and "cannot be shown" are different sentences.** An
 * empty report is good news; a report that never arrived is not, and the
 * page whose job is to say what is wrong must never draw the second as the
 * first (rule 3).
 *
 * **A stopped watchdog is said, not implied** (rule 4): its levels are the
 * last known, and a page that showed them as current would be the stale
 * data the watchdog exists to catch.
 *
 * **A deployment with the inbox only says so**, and a channel that does not
 * exist is never counted as sent (T-802's acceptance).
 *
 * **Refused and unreachable are said in words**, and the charts are drawn
 * by hand: no chart library.
 */

const HERE = __dirname;
const REPORT = readFileSync(join(HERE, 'system-report.tsx'), 'utf8');
const PAGE = readFileSync(
  join(HERE, '..', 'app', '[locale]', 'admin', 'system', 'page.tsx'),
  'utf8',
);
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');
const API = readFileSync(join(HERE, '..', 'lib', 'api.ts'), 'utf8');

describe('the System page', () => {
  it('is linked from the administration index', () => {
    expect(ADMIN).toContain('/admin/system');
  });

  it('reads the watchdog, both failure windows and the alert delivery', () => {
    for (const fetcher of ['fetchWatchdog', 'fetchFailureCounts', 'fetchAdminAlerts']) {
      expect(PAGE).toContain(fetcher);
      expect(API).toContain(`export function ${fetcher}`);
    }
    expect(PAGE).toContain('fetchFailureCounts(24');
    expect(PAGE).toContain('fetchFailureCounts(168');
    expect(API).toContain('/admin/health/watchdog');
    expect(API).toContain('/admin/health/failures?hours=');
    expect(API).toContain('/admin/health/alerts');
  });

  it('says a refusal and an unreachable API plainly, and sends a guest to sign in', () => {
    expect(PAGE).toContain('data-testid="system-forbidden"');
    expect(PAGE).toMatch(/does not have the admin role/);
    expect(PAGE).toContain('data-testid="system-unreachable"');
    expect(PAGE).toMatch(/cannot be reached/);
    expect(PAGE).toMatch(/status === 401[\s\S]*redirect\(/);
    // Not a 404: this page tells a member why it is closed.
    expect(PAGE).not.toContain('notFound()');
  });

  it('gives every section both an empty state and an unavailable state', () => {
    for (const unavailable of [
      'system-watchdog-unavailable',
      'system-alerts-unavailable',
      '-unavailable`', // each failure window
    ]) {
      expect(REPORT).toContain(unavailable);
    }
    for (const none of [
      'system-conditions-none',
      'system-incidents-none',
      'system-events-none',
      'system-alerts-none',
      '-http-none',
      '-jobs-none',
    ]) {
      expect(REPORT, `no empty state ${none}`).toContain(none);
    }
    expect(REPORT).toMatch(/Nothing recorded in the last/);
    expect(REPORT).toMatch(/cannot be shown/);
  });

  it('says a stopped or never-run watchdog above its levels', () => {
    expect(REPORT).toContain('freshnessSentence(report.freshness');
    expect(REPORT).toContain('data-testid={`system-watchdog-${report.freshness}`}');
  });

  it('says when the inbox is the only channel, when nobody is an administrator, and when delivery is behind', () => {
    expect(REPORT).toContain('data-testid="system-alerts-inbox-only"');
    expect(REPORT).toContain('channels.in_product_only');
    expect(REPORT).toContain('data-testid="system-alerts-no-admin"');
    expect(REPORT).toContain('data-testid="system-alerts-pending"');
    expect(REPORT).toContain('channelLine(channels.push');
    expect(REPORT).toContain('channelLine(channels.email');
  });

  it('draws the hours as inline SVG, with a label for a screen reader, and no chart library', () => {
    expect(REPORT).toContain('<svg');
    expect(REPORT).toContain('aria-label={label}');
    expect(REPORT).toContain('stroke="currentColor"');
    for (const source of [REPORT, PAGE]) {
      expect(source).not.toMatch(/from '(recharts|chart\.js|d3|victory|@nivo|echarts)/);
    }
  });
});
