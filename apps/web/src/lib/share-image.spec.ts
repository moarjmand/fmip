import { describe, expect, it } from 'vitest';
import { shareImageOrCopy } from './share-image';

describe('sharing a card picture (T-1723)', () => {
  const url = 'https://example.test/en/called-it/AAAAAAAAAAAAAAAAAAAAAA';
  const file = { name: 'card.png' } as File;

  it('attaches the picture where the browser can share files', async () => {
    const sent: unknown[] = [];
    const outcome = await shareImageOrCopy(
      {
        canShare: () => true,
        shareFiles: async (data) => {
          sent.push(data);
        },
      },
      file,
      url,
      't',
    );
    expect(outcome).toBe('shared');
    expect(sent).toEqual([{ title: 't', url, files: [file] }]);
  });

  it('shares the link alone, or copies it, where it cannot', async () => {
    const links: string[] = [];
    const sheet = {
      canShare: () => false,
      share: async ({ url: shared }: { url: string }) => {
        links.push(shared);
      },
    };
    expect(await shareImageOrCopy(sheet, file, url, 't')).toBe('shared');
    expect(links).toEqual([url]);
    const copied: string[] = [];
    const clipboard = {
      writeText: async (text: string) => {
        copied.push(text);
      },
    };
    expect(await shareImageOrCopy({ clipboard }, null, url, 't')).toBe('copied');
    expect(copied).toEqual([url]);
  });

  it('says nothing when the reader closes the sheet', async () => {
    const closed = Object.assign(new Error('closed'), { name: 'AbortError' });
    const nav = {
      canShare: () => true,
      shareFiles: async () => {
        throw closed;
      },
    };
    expect(await shareImageOrCopy(nav, file, url, 't')).toBe('cancelled');
  });
});
