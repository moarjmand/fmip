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
const PLAYED_MATCH = '00000000-0000-4000-8000-000000000901';

const PAGES = [
  // The Overview opens on the next match card since T-1499; the club's
  // fixture lines, with where to watch them, are on its Fixtures tab.
  { path: `/en/team/${MAN_UTD}`, ready: 'next-match' },
  { path: `/en/team/${MAN_UTD}?tab=fixtures`, ready: 'match-line' },
  { path: `/en/player/${SALAH}`, ready: 'current-team' },
  { path: `/en/competition/${PREMIER_LEAGUE}`, ready: 'fixture' },
  // The match centre (T-1553): Share, the follow line and the sides' names.
  { path: `/en/match/${PLAYED_MATCH}`, ready: 'match-header' },
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

// The Design System's 44px on a phone (T-1553), stricter than axe's 24: the
// match centre's Share, its sign-in-to-follow line and each side's name in
// the score band fell short (37x20, 164x15, 75x20 on production).
test.describe('the match centre at 360px', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('gives Share, the follow line and the sides 44px targets', async ({ page }) => {
    await page.goto(`/en/match/${PLAYED_MATCH}`);
    const header = page.getByTestId('match-header');
    await expect(header).toBeVisible();
    const targets = [
      page.getByTestId('share'),
      page.getByTestId('match-follow-guest').getByRole('link'),
      header.getByTestId('home-team').getByRole('link'),
      header.getByTestId('away-team').getByRole('link'),
    ];
    for (const target of targets) {
      const box = await target.first().boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
