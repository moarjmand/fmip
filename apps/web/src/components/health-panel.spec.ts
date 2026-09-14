import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The operator's panel keeps two promises (T-236).
 *
 * **Unreachable is not zero.** "No connections" and "we could not ask" are
 * different facts, and showing the second as the first is rule 3 on an
 * operational surface: a module that looks populated and is not.
 *
 * **A number says whose it is.** Sockets live on the instance that accepted
 * them. A chat count presented without that is a number the reader will take
 * for the fleet's, and nobody measured that one.
 */

const HERE = __dirname;
const PANEL = readFileSync(join(HERE, 'health-panel.tsx'), 'utf8');
const ADMIN = readFileSync(join(HERE, '..', 'app', '[locale]', 'admin', 'page.tsx'), 'utf8');
const CONTRACT = readFileSync(
  join(HERE, '..', '..', '..', '..', 'packages', 'contracts', 'src', 'health.ts'),
  'utf8',
);

/** The bus states, read from the contract rather than typed out here. */
function busStates(): string[] {
  const line = /export type ChatBusState =([^;]*);/.exec(CONTRACT)?.[1] ?? '';
  return [...line.matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '');
}

describe('the live paths are on the operator page', () => {
  it('is mounted where an operator already looks', () => {
    expect(ADMIN).toContain('<HealthPanel');
    expect(ADMIN).toContain('fetchLiveHealth');
    expect(ADMIN).toContain('fetchChatHealth');
    expect(PANEL).toContain('data-testid="admin-health"');
  });

  it('says it could not ask, rather than showing nothing as zero', () => {
    for (const testId of ['health-live-unreachable', 'health-chat-unreachable']) {
      expect(PANEL, `no stated absence for ${testId}`).toContain(`data-testid="${testId}"`);
    }
    expect(PANEL).toMatch(/could not be asked/);
  });

  it('gives every bus state in the contract words of its own', () => {
    // `absent` and `down` merged into "unhealthy" would put "never configured"
    // and "broke at 02:00" on one line, and they are different people's
    // problems. Reading the list from the contract makes a forgotten state a
    // failing test rather than a fall-through.
    for (const state of busStates()) {
      expect(PANEL, `no words for the ${state} bus`).toContain(`'${state}'`);
    }
    expect(busStates()).toContain('absent');
    expect(busStates().length).toBeGreaterThanOrEqual(3);
  });

  it('says whose numbers these are', () => {
    expect(PANEL).toContain('data-testid="health-chat-scope"');
    expect(PANEL).toMatch(/one instance/);
    expect(PANEL).toContain('chat.instance');
  });

  it('does not report "nothing delivered yet" as instant delivery', () => {
    // `latency_ms` is null until something has been delivered, and 0 ms would
    // be the most flattering possible lie about a channel that has carried
    // nothing at all.
    expect(PANEL).toContain('latency_ms === null');
    expect(PANEL).toMatch(/nothing delivered yet/);
  });
});
