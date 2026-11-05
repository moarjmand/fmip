import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The gate, the return address and the account buttons (T-1736, D-358),
 * without an API: with no session every reader is a guest, which is exactly
 * who these are for. What happens after a real sign-in is the journeys'.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const GATED = [
  '/following',
  '/following/saved',
  '/friends',
  '/notifications',
  '/settings/notifications',
  '/messages',
  '/groups',
];

for (const route of GATED) {
  test(`/en${route} shows a guest the gate, and both ways in come back to it`, async ({ page }) => {
    await page.goto(`/en${route}`);
    await expect(page).toHaveURL(new RegExp(`/en${route}$`));
    const card = page.getByTestId('gate-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(card.getByTestId('gate-value')).not.toBeEmpty();
    const next = encodeURIComponent(`/en${route}`);
    await expect(card.getByTestId('gate-register')).toHaveAttribute(
      'href',
      `/en/register?next=${next}`,
    );
    await expect(card.getByTestId('gate-sign-in')).toHaveAttribute(
      'href',
      `/en/login?next=${next}`,
    );
  });
}

test('the address rides the sign-in form and the link to the register page', async ({ page }) => {
  await page.goto('/en/following');
  await page.getByTestId('gate-sign-in').click();
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Ffollowing$/);
  await expect(page.locator('[data-testid="login-form"] input[name="next"]')).toHaveValue(
    '/en/following',
  );
  await expect(page.getByTestId('login-register')).toHaveAttribute(
    'href',
    '/en/register?next=%2Fen%2Ffollowing',
  );
});

for (const hostile of [
  'https://evil.example/en/following',
  '//evil.example',
  '/\\evil.example',
  '/fa/following',
  '/en/login',
]) {
  test(`the sign-in page ignores next=${hostile}`, async ({ page }) => {
    await page.goto(`/en/login?next=${encodeURIComponent(hostile)}`);
    await expect(page.getByTestId('login-form')).toBeVisible();
    await expect(page.locator('[data-testid="login-form"] input[name="next"]')).toHaveCount(0);
    await expect(page.getByTestId('login-register')).toHaveAttribute('href', '/en/register');
  });
}

test('a guest who asks for the picks still to make sees the gate above the matches', async ({
  page,
}) => {
  await page.goto('/en/scores?unpicked=1');
  const card = page.getByTestId('gate-card');
  await expect(card.getByRole('heading', { level: 2 })).toHaveText('Your picks');
  await expect(card.getByTestId('gate-sign-in')).toHaveAttribute(
    'href',
    '/en/login?next=%2Fen%2Fscores%3Funpicked%3D1',
  );
  // The page keeps its own title; the plain matches page has no gate.
  await expect(page.getByTestId('title')).toBeVisible();
  await page.goto('/en/scores');
  await expect(page.getByTestId('gate-card')).toHaveCount(0);
});

test('Settings keeps its own words for a guest', async ({ page }) => {
  await page.goto('/en/settings');
  await expect(page.getByTestId('settings-guest')).toBeVisible();
  await expect(page.getByTestId('gate-card')).toHaveCount(0);
});

test.describe('in the desktop header', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Create account is the filled button and Sign in the outlined one', async ({ page }) => {
    await page.goto('/en/scores');
    const create = page.getByTestId('nav-create-account');
    const signIn = page.getByTestId('nav-sign-in');
    await expect(create).toBeVisible();
    await expect(create).toHaveText('Create account');
    await expect(create).toHaveAttribute('href', '/en/register');
    await expect(signIn).toHaveAttribute('href', '/en/login');
    const fill = (id: string) =>
      page.getByTestId(id).evaluate((element) => getComputedStyle(element).backgroundColor);
    const brand = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--color-brand)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    expect(await fill('nav-create-account')).toBe(brand);
    expect(await fill('nav-sign-in')).not.toBe(brand);
    // Sign in, then Create account at the end of the row.
    const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x;
    expect(await x('nav-create-account')).toBeGreaterThan(await x('nav-sign-in'));
  });
});

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Menu offers Create account first, both full width', async ({ page }) => {
    await page.goto('/en/scores');
    await page.getByTestId('nav-menu').locator(':scope > summary').click();
    const create = (await page.getByTestId('nav-create-account').boundingBox())!;
    const signIn = (await page.getByTestId('nav-sign-in').boundingBox())!;
    expect(create.y).toBeLessThan(signIn.y);
    for (const box of [create, signIn]) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThan(300);
    }
  });

  for (const locale of ['en', 'fa'] as const) {
    test(`/${locale}: the You tab leads a guest to the two choices, with no overflow`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/scores`);
      await page.getByTestId('tab-you').click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/you$`));
      const card = page.getByTestId('gate-card');
      await expect(card.getByTestId('gate-register')).toHaveAttribute(
        'href',
        `/${locale}/register`,
      );
      await expect(card.getByTestId('gate-sign-in')).toHaveAttribute('href', `/${locale}/login`);
      // Create account above Sign in, each a full-width 44px target.
      const create = (await card.getByTestId('gate-register').boundingBox())!;
      const signIn = (await card.getByTestId('gate-sign-in').boundingBox())!;
      expect(create.y).toBeLessThan(signIn.y);
      for (const box of [create, signIn]) {
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThan(280);
      }
      await expect(page.getByTestId('you-settings')).toHaveAttribute('href', `/${locale}/settings`);
      await expect(page.getByTestId('tab-you')).toHaveAttribute('aria-current', 'page');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }

  test('/fa/friends: the gate is mirrored and passes axe', async ({ page }) => {
    await page.goto('/fa/friends');
    const card = page.getByTestId('gate-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('gate-register')).toHaveText('ساخت حساب');
    expect(await card.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

test('/x-rtl/following: the gate has no horizontal overflow in the pseudo-locale', async ({
  page,
}) => {
  await page.goto('/x-rtl/following');
  await expect(page.getByTestId('gate-card')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
