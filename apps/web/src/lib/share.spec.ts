import { describe, expect, it } from 'vitest';
import { shareMessage, shareOrCopy } from './share';

/** T-521: the share sheet where there is one, a copied link where not. */
describe('sharing a page', () => {
  const url = 'https://fmip.example/en/match/f1';

  it('uses the share sheet when the platform has one, with the page link only', async () => {
    const sent: unknown[] = [];
    const outcome = await shareOrCopy(
      { share: async (data) => void sent.push(data) },
      url,
      'Arsenal v Chelsea',
    );
    expect(outcome).toBe('shared');
    expect(sent).toEqual([{ title: 'Arsenal v Chelsea', url }]);
    expect(shareMessage(outcome, url)).toBeNull();
  });

  it('says nothing when the reader closes the sheet', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    const outcome = await shareOrCopy(
      {
        share: async () => {
          throw abort;
        },
      },
      url,
      't',
    );
    expect(outcome).toBe('cancelled');
    expect(shareMessage(outcome, url)).toBeNull();
  });

  it('copies the link when there is no sheet, or the sheet fails', async () => {
    const copied: string[] = [];
    const clipboard = { writeText: async (text: string) => void copied.push(text) };
    expect(await shareOrCopy({ clipboard }, url, 't')).toBe('copied');
    expect(
      await shareOrCopy(
        {
          share: async () => {
            throw new Error('not allowed');
          },
          clipboard,
        },
        url,
        't',
      ),
    ).toBe('copied');
    expect(copied).toEqual([url, url]);
    expect(shareMessage('copied', url)).toBe('Link copied.');
  });

  it('shows the link to copy by hand when nothing else works', async () => {
    const refused = {
      writeText: async () => {
        throw new Error('denied');
      },
    };
    expect(await shareOrCopy({ clipboard: refused }, url, 't')).toBe('manual');
    expect(await shareOrCopy({}, url, 't')).toBe('manual');
    expect(shareMessage('manual', url)).toBe(`Copy this link: ${url}`);
  });
});
