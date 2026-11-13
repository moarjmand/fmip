import type { MatchSummaryResponse } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EN } from '@/i18n/messages';

vi.mock('@/lib/summary-actions', () => ({ regenerateSummaryAction: () => undefined }));

const { MatchSummaryPanel } = await import('./match-summary');

/**
 * A draft held back is not the reader's business (T-1799, F4): the public
 * page says only that there is no written summary (rule 3); an editor, who
 * can write a new version, still reads why.
 */
const rejected: MatchSummaryResponse = {
  fixture_id: 'f1',
  summary: { coverage: 'not_supplied', last_updated_at: null, data: null },
  reason: 'rejected',
  versions: 1,
};
const panel = (editor: boolean, locale = 'en', summary = rejected) =>
  renderToStaticMarkup(
    <MatchSummaryPanel
      locale={locale}
      timeZone="Europe/London"
      fixtureId="f1"
      status="finished"
      summary={summary}
      editor={editor}
    />,
  );

describe('the match summary when the last draft was held back (T-1799, F4)', () => {
  it('tells a reader only that there is no written summary', () => {
    const html = panel(false);
    expect(html).toContain('data-state="rejected"');
    expect(html).toContain(EN['summary.reason.held']);
    expect(html).not.toContain('did not agree');
    expect(html).not.toContain('held back');
    expect(panel(false, 'fa')).toContain('برای این بازی خلاصه‌ی نوشته‌شده‌ای نیست');
  });

  it('tells an editor why', () => {
    expect(panel(true)).toContain(EN['summary.reason.rejected']);
  });

  it('keeps the other reasons as they were', () => {
    expect(panel(false, 'en', { ...rejected, reason: 'not_generated' })).toContain(
      EN['summary.reason.notGenerated'],
    );
  });
});
