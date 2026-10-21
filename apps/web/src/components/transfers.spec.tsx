import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerTransfers, TeamTransfers, TransferLine } from '@fmip/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyTransfersKey, namesUnheld, transferType } from '@/lib/transfers';
import { PlayerTransfersPanel, TeamTransfersPanel } from './transfers';

/**
 * The club and player pages' transfers (T-1440, D-231): the provider named
 * as the source, our clubs and players linked, the provider's names for the
 * rest as plain text and never a link, the fee as the provider wrote it, and
 * an honest sentence for every way the list can be empty.
 */

const PHYSICAL = /\b(?:m|p|border|rounded)-?[lr]-|\b(?:left|right)-\d|text-(?:left|right)\b/;

function move(over: Partial<TransferLine> = {}): TransferLine {
  return {
    date: '2025-07-01',
    kind: 'fee',
    fee: '€ 75M',
    player: { id: 'p-held', name: 'E. Haaland' },
    from: { id: 't-rival', name: 'Dortmund' },
    to: { id: 't-club', name: 'Man City' },
    ...over,
  };
}

const loanOut = move({
  date: '2026-01-31',
  kind: 'loan',
  fee: null,
  player: { id: null, name: 'B. Stranger' },
  from: { id: 't-club', name: 'Man City' },
  to: { id: null, name: 'Internazionale' },
});
const released = move({
  date: '2026-06-30',
  kind: 'free',
  fee: null,
  from: { id: 't-club', name: 'Man City' },
  to: null,
});

const team = (over: Partial<TeamTransfers['transfers']> = {}): TeamTransfers => ({
  source_name: 'API-Football',
  transfers: {
    coverage: 'available',
    last_updated_at: '2026-10-21T10:00:00Z',
    data: {
      arrivals: [move()],
      departures: [released, loanOut],
      arrivals_total: 1,
      departures_total: 40,
    },
    ...over,
  },
});

const renderTeam = (data: TeamTransfers, locale = 'en') =>
  renderToStaticMarkup(<TeamTransfersPanel data={data} locale={locale} timeZone="UTC" />);
const renderPlayer = (data: PlayerTransfers, locale = 'en') =>
  renderToStaticMarkup(<PlayerTransfersPanel data={data} locale={locale} timeZone="UTC" />);

describe('the helpers', () => {
  it('writes a fee as the provider did, and our words for every other kind', () => {
    expect(transferType(move())).toEqual({ fee: '€ 75M' });
    expect(transferType(loanOut)).toEqual({ key: 'transfers.kind.loan' });
    expect(transferType(move({ kind: 'loan_return', fee: null }))).toEqual({
      key: 'transfers.kind.loanReturn',
    });
    expect(transferType(move({ kind: 'transfer', fee: null }))).toEqual({
      key: 'transfers.kind.transfer',
    });
    expect(transferType(move({ kind: 'fee', fee: null }))).toEqual({
      key: 'transfers.kind.unknown',
    });
  });

  it('tells never asked from asked and none listed', () => {
    expect(emptyTransfersKey(null, 'team')).toBe('transfers.team.notAsked');
    expect(emptyTransfersKey('2026-10-21T10:00:00Z', 'team')).toBe('transfers.team.none');
    expect(emptyTransfersKey(null, 'player')).toBe('transfers.player.notAsked');
    expect(emptyTransfersKey('2026-10-21T10:00:00Z', 'player')).toBe('transfers.player.none');
  });

  it('notices a club or player we do not hold', () => {
    expect(namesUnheld([move()])).toBe(false);
    expect(namesUnheld([move(), loanOut])).toBe(true);
    expect(namesUnheld([released])).toBe(false);
  });
});

describe('the club page section', () => {
  const html = renderTeam(team());

  it('names the source, and lists arrivals and departures with dates and types', () => {
    expect(html).toContain('Transfers, as API-Football lists them');
    expect(html).toContain('data-testid="team-arrivals-table"');
    expect(html).toContain('data-testid="team-departures-table"');
    expect(html).toContain('1 Jul 2025');
    expect(html).toContain('€ 75M');
    expect(html).toContain('Loan');
    expect(html).toContain('No club');
    expect(html).toContain('Fetched from API-Football');
  });

  it('links our clubs and players, and leaves the provider’s names as plain text', () => {
    expect(html).toContain('href="/en/player/p-held"');
    expect(html).toContain('href="/en/team/t-rival"');
    expect(html).not.toMatch(/<a[^>]*>(?:<bdi>)?Internazionale/);
    expect(html).not.toMatch(/<a[^>]*>(?:<bdi>)?B\. Stranger/);
    expect(html).toContain('<bdi data-testid="transfer-unheld">Internazionale</bdi>');
    expect(html).toContain('data-testid="transfers-unheld-note"');
  });

  it('says when a list was cut', () => {
    expect(html).toContain('The latest 2 of 40.');
    expect(html).not.toContain('The latest 1 of 1.');
  });

  it('says why there is nothing: never asked, or none listed', () => {
    const never = renderTeam(team({ coverage: 'not_supplied', last_updated_at: null, data: null }));
    expect(never).toContain(
      'API-Football has not been asked about this club&#x27;s transfers yet.',
    );
    expect(never).not.toContain('Fetched from');
    const none = renderTeam(team({ coverage: 'not_supplied', data: null }));
    expect(none).toContain('API-Football lists no transfer for this club.');
    expect(none).toContain('Fetched from API-Football');
  });

  it('speaks Persian on /fa', () => {
    const fa = renderTeam(team(), 'fa');
    expect(fa).toContain('ورودی‌ها');
    expect(fa).toContain('خروجی‌ها');
    expect(fa).toContain('قرضی');
  });
});

describe('the player page section', () => {
  const player = (over: Partial<PlayerTransfers['transfers']> = {}): PlayerTransfers => ({
    source_name: 'API-Football',
    transfers: {
      coverage: 'available',
      last_updated_at: '2026-10-21T10:00:00Z',
      data: { lines: [released, move()] },
      ...over,
    },
  });

  it('lists every move from and to, newest first', () => {
    const html = renderPlayer(player());
    expect(html).toContain('data-testid="player-transfers-table"');
    expect(html.indexOf('30 Jun 2026')).toBeLessThan(html.indexOf('1 Jul 2025'));
    expect(html).not.toContain('data-testid="player-transfers-limited"');
  });

  it('says when the list comes only from the clubs we follow', () => {
    const html = renderPlayer(player({ coverage: 'limited' }));
    expect(html).toContain('data-testid="player-transfers-limited"');
  });

  it('says why there is nothing', () => {
    const html = renderPlayer(
      player({ coverage: 'not_supplied', last_updated_at: null, data: null }),
    );
    expect(html).toContain(
      'API-Football has not been asked about this player&#x27;s transfers yet.',
    );
  });
});

describe('the layout', () => {
  it('uses logical properties only (rule 7)', () => {
    const source = readFileSync(join(__dirname, 'transfers.tsx'), 'utf8');
    expect(PHYSICAL.test(source)).toBe(false);
  });
});
