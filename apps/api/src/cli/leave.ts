/**
 * Leaving a command-line tool once what it printed has been handed over
 * (T-1754).
 *
 * Standard output to a pipe is written asynchronously, so `process.exit`
 * straight after a long `process.stdout.write` ends the process with part of
 * the answer still queued: through `docker compose exec` a request's picture
 * arrived cut at exactly 128 KiB of its base64, and the publisher refused it
 * ("sha256 does not match"). A list of requests or of commands long enough
 * would be cut the same way, into JSON that does not parse.
 *
 * Writes are handed over in order, so the callback of an empty write runs
 * when everything written before it has gone.
 */
export function leaveWhenWritten(
  code: number,
  out: Pick<NodeJS.WritableStream, 'write'> = process.stdout,
  exit: (code: number) => void = (status) => process.exit(status),
): void {
  out.write('', () => exit(code));
}
