import type { NormalisedIncident } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import { withoutRepeats } from './internal/ingest-store';

/**
 * T-1394 (D-209): a booking, a sending-off or a substitution the provider's
 * list carries twice is written once. Portugal v Norway, 2026-10-04: the
 * list booked F. Conceicao at 86' twice, then sent him off.
 */
let sequence = 0;
function incident(over: Partial<NormalisedIncident> = {}): NormalisedIncident {
  sequence += 1;
  return {
    fixtureExternalId: '1',
    sequence,
    minute: 86,
    addedTime: null,
    kind: 'yellow_card',
    side: 'home',
    player: { externalId: 'conceicao', name: 'F. Conceicao' },
    relatedPlayer: null,
    detail: null,
    ...over,
  };
}

describe('withoutRepeats', () => {
  it('keeps the first of two identical bookings and everything else in order', () => {
    const goal = incident({
      kind: 'goal',
      minute: 79,
      player: { externalId: 'ramos', name: 'G. Ramos' },
    });
    const yellow = incident();
    const again = incident();
    const red = incident({ kind: 'red_card' });
    const kept = withoutRepeats([goal, yellow, again, red]);
    expect(kept.map((i) => i.sequence)).toEqual([goal.sequence, yellow.sequence, red.sequence]);
  });

  it('drops a repeated substitution, never two different ones in the same minute', () => {
    const off = (out: string, on: string) =>
      incident({
        kind: 'substitution',
        minute: 90,
        player: { externalId: out, name: out },
        relatedPlayer: { externalId: on, name: on },
      });
    const felix = off('felix', 'tavares');
    const bruno = off('bruno', 'trincao');
    const kept = withoutRepeats([felix, bruno, off('felix', 'tavares')]);
    expect(kept.map((i) => i.sequence)).toEqual([felix.sequence, bruno.sequence]);
  });

  it('keeps bookings that differ in minute, added time, side or player', () => {
    const list = [
      incident({ minute: 15 }),
      incident({ minute: 49 }),
      incident({ minute: 45, addedTime: 2 }),
      incident({ minute: 45, addedTime: 3 }),
      incident({ side: 'away', player: { externalId: 'other', name: 'Other' } }),
    ];
    expect(withoutRepeats(list)).toHaveLength(5);
  });

  it('never drops a goal or a VAR review, which can repeat for real', () => {
    const brace = [
      incident({ kind: 'goal', minute: 90, addedTime: 4 }),
      incident({ kind: 'goal', minute: 90, addedTime: 4 }),
      incident({ kind: 'var', player: null, side: null, detail: 'goal_cancelled' }),
      incident({ kind: 'var', player: null, side: null, detail: 'goal_cancelled' }),
    ];
    expect(withoutRepeats(brace)).toHaveLength(4);
  });
});
