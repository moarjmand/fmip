import type { TransferKind, TransferLine } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * The club and player pages' transfers (T-1440, D-231): pure helpers, so the
 * rules are tested without rendering.
 */

const KIND_KEYS: Record<Exclude<TransferKind, 'fee'>, MessageKey> = {
  loan: 'transfers.kind.loan',
  loan_return: 'transfers.kind.loanReturn',
  free: 'transfers.kind.free',
  transfer: 'transfers.kind.transfer',
  unknown: 'transfers.kind.unknown',
};

/**
 * How a move's type is written: the provider's fee as it wrote it (a figure
 * and a currency are not words to translate), or our words for the kind.
 */
export function transferType(line: TransferLine): { fee: string } | { key: MessageKey } {
  if (line.kind === 'fee' && line.fee !== null) return { fee: line.fee };
  return { key: KIND_KEYS[line.kind === 'fee' ? 'unknown' : line.kind] };
}

/** A move's day as an instant at midnight UTC, for a date formatter in the UTC zone. */
export function transferDay(line: TransferLine): string {
  return `${line.date}T00:00:00Z`;
}

/** What a section says when it has no line: never asked, or asked and none listed. */
export function emptyTransfersKey(
  lastUpdatedAt: string | null,
  subject: 'team' | 'player',
): MessageKey {
  if (lastUpdatedAt === null) {
    return subject === 'team' ? 'transfers.team.notAsked' : 'transfers.player.notAsked';
  }
  return subject === 'team' ? 'transfers.team.none' : 'transfers.player.none';
}

/** Whether a list names a club or a player we do not hold, so the note about plain names is shown. */
export function namesUnheld(lines: TransferLine[]): boolean {
  return lines.some(
    (l) =>
      l.player.id === null ||
      (l.from !== null && l.from.id === null) ||
      (l.to !== null && l.to.id === null),
  );
}
