import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { leaveWhenWritten } from './leave';

/** A pipe that takes its time: each chunk is handed over a tick later. */
function slowPipe(): { out: Writable; written: () => number } {
  let bytes = 0;
  const out = new Writable({
    highWaterMark: 16 * 1024,
    write(chunk: Buffer, _encoding, done) {
      setTimeout(() => {
        bytes += chunk.length;
        done();
      }, 5);
    },
  });
  return { out, written: () => bytes };
}

describe('leaveWhenWritten (T-1754)', () => {
  it('leaves only once a long answer has been handed over whole', async () => {
    const { out, written } = slowPipe();
    // A request's picture as the console prints it: 327 kB is about 436 kB of base64.
    const answer = `${'A'.repeat(436_000)}\n`;
    out.write(answer);
    const left = new Promise<{ code: number; bytes: number }>((resolve) =>
      leaveWhenWritten(7, out, (code) => resolve({ code, bytes: written() })),
    );
    // Not yet: the answer is still queued when the tool asks to leave.
    expect(written()).toBeLessThan(answer.length);
    await expect(left).resolves.toEqual({ code: 7, bytes: answer.length });
  });

  it('leaves with its code when nothing was printed', async () => {
    const { out } = slowPipe();
    const code = await new Promise<number>((resolve) => leaveWhenWritten(1, out, resolve));
    expect(code).toBe(1);
  });

  it('keeps the order of several answers', async () => {
    const { out, written } = slowPipe();
    out.write('first\n');
    out.write('second\n');
    const bytes = await new Promise<number>((resolve) =>
      leaveWhenWritten(0, out, () => resolve(written())),
    );
    expect(bytes).toBe('first\nsecond\n'.length);
  });
});
