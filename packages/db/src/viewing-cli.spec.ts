import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as viewing from '../scripts/viewing.mjs';

const { parseArgs } = viewing as {
  parseArgs: (argv: string[]) => Record<string, unknown> & { error?: string };
};

/**
 * The refusals in `scripts/viewing.mjs` (T-1360): the desk's listings from a
 * terminal. Every write is signed by an admin or editor, a competition is
 * never named by its name, and a default names its schedule.
 */
const BROADCASTER = '00000000-0000-4000-8000-0000000000b1';
const setDefault = [
  '--set-default',
  '--competition',
  '39',
  '--territory',
  'ir',
  '--broadcaster',
  BROADCASTER,
  '--access',
  'free',
  '--url',
  'https://tv.test/live',
  '--note',
  'the published schedule',
];

describe('viewing.mjs parseArgs', () => {
  it('takes one verb and refuses unknown options', () => {
    expect(parseArgs([]).error).toBe('Name one verb.');
    expect(parseArgs(['--list-defaults', '--list-broadcasters']).error).toMatch(/One verb/);
    expect(parseArgs(['--list-defaults', '--colour', 'red']).error).toMatch(/Unknown option/);
    expect(parseArgs(['--list-broadcasters'])).toEqual({ command: 'list-broadcasters' });
  });

  it('requires --by on every write, and --dry-run only on a write', () => {
    expect(parseArgs(setDefault).error).toMatch(/--by is required/);
    expect(parseArgs(['--list-defaults', '--dry-run']).error).toMatch(/for a write/);
    expect(parseArgs([...setDefault, '--by', 'ed@example.test', '--dry-run'])).toEqual({
      command: 'set-default',
      competition: '39',
      territory: 'IR',
      broadcaster: BROADCASTER,
      access: 'free',
      url: 'https://tv.test/live',
      note: 'the published schedule',
      by: 'ed@example.test',
      dryRun: true,
    });
  });

  it('refuses a default without a schedule, a uuid broadcaster, a known access or an http(s) page', () => {
    const by = ['--by', 'ed@example.test'];
    const without = (flag: string) => {
      const args = [...setDefault];
      const at = args.indexOf(flag);
      args.splice(at, 2);
      return [...args, ...by];
    };
    expect(parseArgs(without('--note')).error).toMatch(/--note is required/);
    expect(parseArgs(without('--competition')).error).toMatch(/never a name/);
    const swap = (flag: string, value: string) => {
      const args = [...setDefault, ...by];
      args[args.indexOf(flag) + 1] = value;
      return args;
    };
    expect(parseArgs(swap('--broadcaster', 'IRIB')).error).toMatch(/uuid/);
    expect(parseArgs(swap('--access', 'pirate')).error).toMatch(/--access/);
    expect(parseArgs(swap('--url', 'ftp://x')).error).toMatch(/http/);
    expect(parseArgs(swap('--territory', 'IRN')).error).toMatch(/alpha-2/);
  });

  it('declares with a module and an editor state only', () => {
    const declare = [
      '--declare',
      '--competition',
      '39',
      '--territory',
      'IR',
      '--module',
      'viewing',
      '--state',
      'available',
      '--note',
      'schedule',
      '--by',
      'ed@example.test',
    ];
    expect(parseArgs(declare)).toMatchObject({ command: 'declare', state: 'available' });
    const delayed = [...declare];
    delayed[delayed.indexOf('--state') + 1] = 'delayed';
    expect(parseArgs(delayed).error).toMatch(/--state/);
  });

  it('removes a default by uuid with a reason, and adds a broadcaster of a known kind', () => {
    expect(
      parseArgs(['--remove-default', '--id', BROADCASTER, '--by', 'ed@example.test']).error,
    ).toMatch(/--reason/);
    expect(
      parseArgs(['--add-broadcaster', '--name', 'IRIB', '--kind', 'cable', '--by', 'a@b.test'])
        .error,
    ).toMatch(/--kind/);
    expect(
      parseArgs(['--add-broadcaster', '--name', 'IRIB', '--kind', 'tv', '--by', 'a@b.test']),
    ).toEqual({
      command: 'add-broadcaster',
      name: 'IRIB',
      kind: 'tv',
      homepage: null,
      by: 'a@b.test',
      dryRun: false,
    });
  });

  it('reads the next days of a competition, and lists one match by its provider id (T-1362)', () => {
    expect(parseArgs(['--upcoming', '--competition', '290', '--territory', 'ir'])).toEqual({
      command: 'upcoming',
      competition: '290',
      territory: 'IR',
      days: 2,
    });
    expect(
      parseArgs(['--upcoming', '--competition', '290', '--territory', 'IR', '--days', '30']).error,
    ).toMatch(/1 to 21/);
    const list = [
      '--list',
      '--fixture',
      '1500001',
      '--territory',
      'IR',
      '--broadcaster',
      BROADCASTER,
      '--access',
      'free',
      '--url',
      'https://tv.test/live/tv3',
      '--note',
      'the daily published schedule',
    ];
    expect(parseArgs(list).error).toMatch(/--by is required/);
    expect(parseArgs([...list, '--by', 'ed@test'])).toMatchObject({
      command: 'list',
      fixture: '1500001',
      territory: 'IR',
      broadcaster: BROADCASTER,
      dryRun: false,
    });
    expect(parseArgs([...list.slice(0, -2), '--by', 'ed@test']).error).toMatch(/--note/);
    expect(parseArgs(['--list', '--territory', 'IR', '--by', 'ed@test']).error).toMatch(
      /--fixture/,
    );
  });
});
