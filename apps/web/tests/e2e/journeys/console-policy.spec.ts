import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ConsoleSnapshot } from '@fmip/contracts';
import { type Page, expect, test } from '@playwright/test';
import { CONSOLE_HOST, CONSOLE_POLICY, watchPolicy } from '../console-policy';

/**
 * Every page of the agents console under its enforced content policy
 * (T-1881), signed in, under the site's path and on the console's own host:
 * each page answers with the policy, is styled and drawn, and the browser
 * refuses nothing -- no `securitypolicyviolation` event and no console error
 * about the policy. `console-headers.spec.ts` can only see the sign-in page;
 * this is everything behind it.
 *
 * Runs only in the `journeys` project: it needs the API, its database and
 * the API's built CLI. The account is made the way a console account is
 * made: an invitation from `cli/agents-console.js invite` (there is no route
 * for one), opened in the browser, with a name and a password of this run.
 * The snapshot the pages draw is loaded by the same CLI, as the maintainer's
 * computer loads one, and only where the database holds none.
 */

const RUN = Date.now().toString(36);
const USERNAME = `e2e.console.${RUN}`;
/** A throwaway fixture credential for a database that lives as long as the job. */
const PASSWORD = 'correct horse battery staple';
const AGENT = 'qa-engineer';

const CLI = resolve(__dirname, '../../../../api/dist/cli/agents-console.js');

/** The API's console CLI, against the database and secret the API itself runs with. */
function consoleCli(args: string[], env: Record<string, string>, input?: string): string {
  return execFileSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

const NOW = new Date().toISOString();

/** A snapshot with one of everything the pages draw: an agent with its schematic, a finding, a report, a decision. */
const SNAPSHOT: ConsoleSnapshot = {
  schema: 1,
  generated_at: NOW,
  agents: [
    {
      name: AGENT,
      description: 'Tests the site like its users and its CI.',
      model: 'sonnet',
      tools: ['Read', 'Grep', 'Bash'],
      access: [{ area: 'repository', level: 'read', tools: ['Read', 'Grep'] }],
      skills: ['fmip-qa'],
      schedule: 'daily',
      paused: false,
      workflow: { inputs: ['the pull request'], steps: ['run the tests'], outputs: ['a report'] },
      flow: {
        triggers: [{ kind: 'schedule', detail: null }],
        inputs: [{ kind: 'github', detail: null }],
        steps: [{ text: 'Run the targeted tests', fa: null }],
        limits: [{ kind: 'no-merge-deploy', detail: null }],
        outputs: [{ kind: 'report', detail: null }],
        readers: [{ kind: 'maintainer', detail: null }],
      },
      memory: {
        sources: [{ kind: 'instructions', label: 'agent file', path: '.claude/agents/qa.md' }],
        entries: [{ path: 'notes.md', updated_at: NOW, text: 'Nothing yet.' }],
      },
      runs: [
        { at: NOW, status: 'ok', findings: 2, duration_seconds: 90 },
        { at: NOW, status: 'failed', findings: 0, duration_seconds: null },
      ],
    },
  ],
  findings: [
    {
      id: `e2e-${RUN}`,
      agent: AGENT,
      severity: 'minor',
      status: 'open',
      title: 'A finding of the console policy journey',
      opened_at: NOW,
      detail: 'Made by an end-to-end test.',
      related: null,
    },
  ],
  reports: [
    {
      agent: AGENT,
      date: NOW.slice(0, 10),
      title: 'A report of the console policy journey',
      path: 'reports/qa-engineer/e2e.md',
      text: 'Made by an end-to-end test.',
    },
  ],
  brief: { date: NOW.slice(0, 10), text: 'All quiet.' },
  decisions: [
    {
      id: `e2e-${RUN}`,
      title: 'A decision of the console policy journey',
      status: 'open',
      summary: 'Made by an end-to-end test.',
      options: [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ],
      answer: null,
      decided_by: null,
      decided_at: null,
    },
  ],
};

/** The console's pages behind the sign-in, by their path under its base. */
const PAGES = [
  '/',
  `/agents/${AGENT}`,
  `/agents/${AGENT}/chat`,
  '/findings',
  '/reports',
  '/decisions',
  '/requests',
  '/checklist',
  '/canvas',
  '/board',
  '/calendar',
  '/calendar/subscriptions',
  '/model',
  '/providers',
  '/social',
  '/audit',
];

/**
 * Opens each page and holds it to the policy: answered with it, styled,
 * drawn, and given until the network is quiet to hydrate. `seen` gathers
 * what the document refused before the next one replaces it.
 */
async function walk(page: Page, base: string, seen: () => Promise<string[]>): Promise<void> {
  for (const path of PAGES) {
    const address = path === '/' ? base || '/' : `${base}${path}`;
    await test.step(address, async () => {
      const response = await page.goto(address);
      expect(response?.status(), address).toBe(200);
      expect(response?.headers()['content-security-policy'], address).toMatch(CONSOLE_POLICY);
      expect(response?.headers()['x-frame-options'], address).toBe('DENY');
      // Still signed in, and the inlined stylesheet applied.
      await expect(page, address).not.toHaveURL(/\/login$/);
      await expect(page.locator('body')).toHaveCSS('font-family', /Vazirmatn/);
      await expect(page.locator('main').first()).toBeVisible();
      // T-1906: the computer's heartbeat bar is on every page, in a state it can
      // know (a snapshot is loaded and the API answers), drawn under the policy.
      const heartbeat = page.getByTestId('pc-heartbeat');
      await expect(heartbeat, address).toBeVisible();
      await expect(heartbeat, address).toHaveAttribute('data-state', /^(fresh|late|silent)$/);
      await expect(heartbeat, address).toHaveAttribute('role', 'status');
      await page.waitForLoadState('networkidle');
      await seen();
    });
  }
}

/** A real picture for the request form: a corner of the page itself. */
async function attachPicture(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/requests`);
  const picture = await page.screenshot({ clip: { x: 0, y: 0, width: 160, height: 120 } });
  const form = page.getByTestId('new-request-form');
  await form
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'corner.png', mimeType: 'image/png', buffer: picture });
  // Its preview is a `blob:` address, which `img-src` has to allow.
  const preview = form.getByTestId('pending-strip').locator('img').first();
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
}

/** The reminders' service worker registers at the console's base (`worker-src`). */
async function registerWorker(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/calendar`);
  const scope = `${base}/`;
  const registered = await page.evaluate(async (scopePath) => {
    const registration = await navigator.serviceWorker.register(`${scopePath}reminders-worker`, {
      scope: scopePath,
    });
    const path = new URL(registration.scope).pathname;
    await registration.unregister();
    return path;
  }, scope);
  expect(registered).toBe(scope);
}

test.describe.configure({ mode: 'serial' });

test.describe('the agents console under its enforced content policy', () => {
  // Sixteen pages each, and the CLI starts the API's modules twice.
  test.setTimeout(180_000);

  test('an invited person opens an account, and every page under the path refuses nothing', async ({
    page,
    baseURL,
  }) => {
    const refused = await watchPolicy(page);

    // The invitation, as the server's own command makes it.
    const printed = consoleCli(['invite', '--name', `E2E ${RUN}`], {
      CONSOLE_URL: `${baseURL}/agents`,
    });
    const link = /^(\S+\/invite\/\S+)$/m.exec(printed)?.[1];
    expect(link, 'the invitation link the CLI printed').toBeDefined();

    const invitation = await page.goto(link!);
    expect(invitation?.headers()['content-security-policy']).toMatch(CONSOLE_POLICY);
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('input[name="confirm"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/agents$/);

    // Something to draw, unless this database already holds a snapshot.
    await page.waitForLoadState('networkidle');
    if ((await page.locator(`a[href^="/agents/agents/"]`).count()) === 0) {
      consoleCli(['load-snapshot'], {}, JSON.stringify(SNAPSHOT));
      await page.reload();
    }
    await expect(page.locator(`a[href="/agents/agents/${AGENT}"]`).first()).toBeVisible();

    await walk(page, '/agents', refused);
    // The agent page drew its schematic as inline SVG.
    await page.goto(`/agents/agents/${AGENT}`);
    await expect(page.locator('main svg').first()).toBeVisible();
    // And, above its controls, the heartbeat in one line with the sync's real times (T-1906).
    await expect(page.getByTestId('pc-heartbeat-compact')).toBeVisible();
    await expect(page.locator('main')).toContainText('همگام‌سازی روزی سه بار است');
    await attachPicture(page, '/agents');
    await registerWorker(page, '/agents');
    // A client-side move between pages asks for the payload under the policy too.
    await page.goto('/agents');
    await page.locator('a[href="/agents/findings"]').first().click();
    await expect(page).toHaveURL(/\/agents\/findings$/);

    expect(await refused()).toEqual([]);
  });

  test('the same person signs in on the console’s own host, and every page there refuses nothing', async ({
    page,
    baseURL,
  }) => {
    const refused = await watchPolicy(page);
    // Chromium resolves every name under `localhost` to this machine.
    const host = baseURL!.replace('127.0.0.1', CONSOLE_HOST);

    await page.goto(`${host}/login`);
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(`${host}/`);

    await walk(page, host, refused);
    await attachPicture(page, host);

    expect(await refused()).toEqual([]);
  });
});
