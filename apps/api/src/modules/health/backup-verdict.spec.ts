import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = join(__dirname, '..', '..', '..', '..', '..', 'deploy', 'backup-verdict.sh');

interface Verdict {
  state: string;
  detail: string;
  note: string;
  fails: boolean;
}

/**
 * The Backups line of `deploy/check-setup.sh` (T-1427, D-219), run as it
 * ships: the function is sourced from the file and called through bash, not
 * copied here. From 2026-10-12 to 2026-10-20 production's line said ON while
 * the remote refused every copy, because only the local dump's age was read;
 * the watchdog's `backup` condition had said `failing` the whole time.
 */
async function verdict(
  ageH: string,
  remote: string,
  level: string,
  since = '',
  note = '',
): Promise<Verdict> {
  const argv = [
    '-c',
    '. "$0"; backup_verdict "$@"',
    SCRIPT,
    ageH,
    remote,
    level,
    since,
    note,
    '/srv/backups',
  ];
  let stdout: string;
  let fails = false;
  try {
    ({ stdout } = await run('bash', argv, { env: { PATH: process.env.PATH ?? '' } }));
  } catch (error) {
    const failed = error as { code?: number; stdout?: string };
    if (failed.code !== 1 || failed.stdout === undefined) throw error;
    stdout = failed.stdout;
    fails = true;
  }
  const [state = '', detail = '', rest = ''] = stdout.replace(/\n$/, '').split('|');
  return { state, detail, note: rest, fails };
}

describe('backup verdict', () => {
  it('fails the run when the watchdog says failing, even with a fresh local dump', async () => {
    const seen = await verdict(
      '13',
      'offsite:',
      'failing',
      '2026-10-12 18:08',
      'the newest backup failed: backup.sh stopped with status 7 during: off-provider copy',
    );
    expect(seen).toMatchObject({ state: 'FAILED', fails: true });
    expect(seen.detail).toBe(
      'watchdog failing since 2026-10-12 18:08 UTC: the newest backup failed: backup.sh stopped with status 7 during: off-provider copy',
    );
    expect(seen.note).toContain('journalctl -u fmip-backup');
    expect(seen.note).toContain('journalctl -u fmip-wal-ship');
    expect(seen.note).toContain('offsite:');
  });

  it('fails on degraded too: one refused night is already a missing copy', async () => {
    const seen = await verdict(
      '2',
      'offsite:',
      'degraded',
      '2026-10-13 03:39',
      'WAL archiving is failing',
    );
    expect(seen).toMatchObject({ state: 'FAILED', fails: true });
  });

  it('keeps the watchdog note on one line and short, and never lets it split the fields', async () => {
    const long = `line one\nline | two ${'x'.repeat(400)}`;
    const seen = await verdict('1', 'offsite:', 'failing', '2026-10-12 18:08', long);
    expect(seen.state).toBe('FAILED');
    expect(seen.detail).not.toContain('\n');
    expect(seen.detail.endsWith('...')).toBe(true);
    expect(seen.detail.length).toBeLessThan(300);
    expect(seen.note).toContain('journalctl');
  });

  it('is ON with a fresh dump and a healthy watchdog, and says the watchdog agrees', async () => {
    const seen = await verdict(
      '13',
      'offsite:',
      'ok',
      '2026-10-01 00:00',
      'seconds since the newest successful backup',
    );
    expect(seen).toEqual({
      state: 'ON',
      detail: 'newest dump 13h old, off-site copy to offsite:, watchdog ok',
      note: '',
      fails: false,
    });
  });

  it('reads the local dump alone when the watchdog could not be read or knows nothing', async () => {
    for (const level of ['', 'unknown']) {
      const seen = await verdict('5', 'offsite:', level);
      expect(seen).toEqual({
        state: 'ON',
        detail: 'newest dump 5h old, off-site copy to offsite:',
        note: '',
        fails: false,
      });
    }
  });

  it('keeps STALE and off as reports, not failures, as before', async () => {
    const stale = await verdict('60', 'offsite:', '');
    expect(stale).toMatchObject({
      state: 'STALE',
      detail: 'newest dump is 60h old, off-site copy to offsite:',
      fails: false,
    });
    const off = await verdict('', '', '');
    expect(off).toMatchObject({
      state: 'off',
      detail: 'no dump in /srv/backups -- nothing has been backed up here',
      fails: false,
    });
  });

  it('notes a copy that never leaves the machine', async () => {
    const seen = await verdict('3', '', 'ok');
    expect(seen).toMatchObject({ state: 'ON', fails: false });
    expect(seen.detail).toBe('newest dump 3h old, local only, watchdog ok');
    expect(seen.note).toContain('set BACKUP_RCLONE_REMOTE');
  });
});
