import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The register form as a guest meets it (T-1737, D-358, board P1-7), with the
 * API behind the web app: without one the page says registration is
 * unavailable and draws no form. Nothing is submitted here; registering is
 * `journeys.spec.ts`'s and `members.ts`'s.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('asks for what only the reader knows, in the board’s order', async ({ page }) => {
  await page.goto('/en/register');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account');
  await expect(page.getByTestId('register-points').getByRole('listitem')).toHaveText([
    'Pick the result before kick-off',
    'Earn a rating anyone can recompute',
    'Follow your teams',
  ]);
  const form = page.getByTestId('register-form');
  const names = await form
    .locator('input:not([type="hidden"]), select')
    .evaluateAll((fields) => fields.map((field) => field.getAttribute('name')));
  expect(names).toEqual([
    'username',
    'email',
    'password',
    'country_id',
    'timezone',
    'accept_rules',
  ]);
  await expect(form.getByLabel('Display name')).toHaveCount(0);
  await expect(form.getByLabel('Language')).toHaveCount(0);
  // The country says what it is for; the e-mail too, under the button.
  await expect(form).toContainText(
    'Stored with your account, so the platform can send a message to members in one country.',
  );
  await expect(page.getByTestId('register-email-use')).toHaveText(
    'We use your email only for sign-in, password reset and the notifications you choose.',
  );
  // The rules are one tap away, inside the checkbox's own label.
  await expect(form.getByLabel('I accept the platform rules')).not.toBeChecked();
  await expect(page.getByTestId('register-rules-link')).toHaveAttribute('href', '/en/rules');
  // The register page's own button is the view's filled one: the header keeps Sign in alone.
  await expect(page.getByTestId('nav-create-account')).toBeHidden();
});

test('shows the device’s zone on one line, with the list behind Change', async ({ page }) => {
  await page.goto('/en/register');
  const form = page.getByTestId('register-form');
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const line = form.getByTestId('timezone-line');
  await expect(form.getByTestId('timezone-value')).toHaveText(zone);
  const list = form.getByLabel('Time zone', { exact: true });
  await expect(list).toBeHidden();
  await line.locator('summary').click();
  await expect(list).toBeVisible();
  await list.selectOption('Europe/London');
  await expect(form.getByTestId('timezone-value')).toHaveText('Europe/London');
});

test('shows and hides the password without losing it', async ({ page }) => {
  await page.goto('/en/register');
  const form = page.getByTestId('register-form');
  const password = form.getByLabel('Password', { exact: true });
  await password.fill('a-value-nobody-uses-1');
  const reveal = form.getByTestId('password-reveal');
  await expect(reveal).toHaveText(/Show/);
  await reveal.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(reveal).toHaveText(/Hide/);
  await reveal.click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('a-value-nobody-uses-1');
  await expect(form).toContainText('At least 10 characters.');
});

test('carries the return address in the form and to the sign-in page', async ({ page }) => {
  await page.goto('/en/register?next=%2Fen%2Ffollowing');
  await expect(page.locator('[data-testid="register-form"] input[name="next"]')).toHaveValue(
    '/en/following',
  );
  await expect(page.getByTestId('register-sign-in')).toHaveAttribute(
    'href',
    '/en/login?next=%2Fen%2Ffollowing',
  );
  await page.goto('/en/register?next=https%3A%2F%2Fevil.example');
  await expect(page.locator('[data-testid="register-form"] input[name="next"]')).toHaveCount(0);
  await expect(page.getByTestId('register-sign-in')).toHaveAttribute('href', '/en/login');
});

for (const locale of ['en', 'fa'] as const) {
  test.describe(`/${locale}/register on a 390px phone`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('fits, with a full-width button, 44px targets and no axe violation', async ({ page }) => {
      await page.goto(`/${locale}/register`);
      const form = page.getByTestId('register-form');
      await expect(form).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const formBox = (await form.boundingBox())!;
      const button = (await form.locator('button[type="submit"]').boundingBox())!;
      expect(Math.round(button.width)).toBe(Math.round(formBox.width));
      expect(button.height).toBeGreaterThanOrEqual(44);
      const row = (await form.locator('label:has(input[name="accept_rules"])').boundingBox())!;
      expect(row.height).toBeGreaterThanOrEqual(44);
      const summary = (await form.getByTestId('timezone-line').locator('summary').boundingBox())!;
      expect(summary.height).toBeGreaterThanOrEqual(44);
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  });
}

test('/fa/register keeps Latin values left-to-right inside the mirrored page', async ({ page }) => {
  await page.goto('/fa/register');
  const form = page.getByTestId('register-form');
  expect(await form.evaluate((element) => getComputedStyle(element).direction)).toBe('rtl');
  for (const name of ['username', 'email', 'password']) {
    const field = form.locator(`input[name="${name}"]`);
    await expect(field).toHaveAttribute('dir', 'ltr');
    await expect(field).toHaveAttribute('autocapitalize', 'off');
    await expect(field).toHaveAttribute('spellcheck', 'false');
    expect(await field.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  }
  await expect(form.locator('input[name="email"]')).toHaveAttribute('inputmode', 'email');
  await expect(form.locator('input[name="username"]')).toHaveAttribute('autocomplete', 'username');
  await expect(form.locator('input[name="password"]')).toHaveAttribute(
    'autocomplete',
    'new-password',
  );
  // The words around them are Persian, and the zone stays Latin on its line.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('حساب خود را بسازید');
  await expect(form.getByTestId('timezone-line')).toContainText('منطقه‌ی زمانی:');
  await expect(form.getByTestId('timezone-value')).toHaveAttribute('dir', 'ltr');
  // The sign-in form's two fields are Latin too.
  await page.goto('/fa/login');
  for (const name of ['identifier', 'password']) {
    await expect(page.locator(`[data-testid="login-form"] input[name="${name}"]`)).toHaveAttribute(
      'dir',
      'ltr',
    );
  }
});
