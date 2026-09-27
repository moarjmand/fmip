import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The team, player and competition pages with the seed behind them, at a
 * desktop width and on a 360px phone: axe finds nothing, `target-size`
 * (WCAG 2.2 AA, 24 x 24) included.
 *
 * Without an API these pages show only their "cannot be shown" notice, so the
 * plain a11y project never meets a fixture line or a "where to watch" line:
 * the dense lines of small inline links that fell short of the minimum here.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MAN_UTD = '00000000-0000-4000-8000-000000000601';
const SALAH = '00000000-0000-4000-8000-000000000701';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';

const PAGES = [
  { path: `/en/team/${MAN_UTD}`, ready: 'match-line' },
  { path: `/en/player/${SALAH}`, ready: 'current-team' },
  { path: `/en/competition/${PREMIER_LEAGUE}`, ready: 'fixture' },
];

for (const width of [1280, 360]) {
  test.describe(`seeded entity pages at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const { path, ready } of PAGES) {
      test(`${path} passes axe, target-size included`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByTestId(ready).first()).toBeVisible();

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
          ),
        ).toEqual([]);
        // The rule actually ran: a tag set without WCAG 2.2 would skip it.
        const ran = [...results.passes, ...results.incomplete, ...results.inapplicable];
        expect(ran.map((r) => r.id)).toContain('target-size');
      });
    }
  });
}
