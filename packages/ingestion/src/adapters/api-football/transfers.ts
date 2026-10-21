/**
 * API-Football `/transfers?team=` and `/transfers?player=` → the normalised
 * model (T-1440, D-231). Kept apart from `map.ts`, as the player seasons are.
 *
 * Field names below are API-Football's. None of them leave this directory.
 */

import type {
  EntityRef,
  NormalisedTransfer,
  NormalisedTransferClub,
  TransferKind,
} from '../../normalised';
import { decodeEntities } from '../../news/feed';
import { isRecord, type Json } from './map';

const rec = (value: unknown): Json => (isRecord(value) ? value : {});

/** API-Football ids are numbers; the contract wants them as strings. */
const id = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : null;

/** A name with entities decoded and whitespace collapsed, or `null` when it holds no letter. */
function plain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(name) ? name : null;
}

/** A calendar day the provider wrote as `YYYY-MM-DD`, checked to be a real one. */
function day(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** A fee as the provider writes it: a currency sign and a figure, either way round ("€ 75M", "7M €"). */
const FEE = /^(?:[€£$]\s?\d[\d.,]*\s?[KMB]?|\d[\d.,]*\s?[KMB]?\s?[€£$])$/i;

/**
 * The kind of move, from the provider's word for it. Seen in answers
 * (2026-10-21): "Loan", "Return from loan", "Back from Loan", "Free",
 * "Free Transfer", "Free agent", "Transfer", a fee, and "N/A", "-" and
 * "Raise", which say nothing we can read. Pure.
 */
export function transferKind(raw: unknown): { kind: TransferKind; fee: string | null } {
  if (typeof raw !== 'string') return { kind: 'unknown', fee: null };
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (FEE.test(text)) return { kind: 'fee', fee: text };
  switch (text.toLowerCase()) {
    case 'loan':
      return { kind: 'loan', fee: null };
    case 'return from loan':
    case 'back from loan':
    case 'end of loan':
    case 'loan end':
      return { kind: 'loan_return', fee: null };
    case 'free':
    case 'free transfer':
    case 'free agent':
      return { kind: 'free', fee: null };
    case 'transfer':
      return { kind: 'transfer', fee: null };
    default:
      return { kind: 'unknown', fee: null };
  }
}

/** One side's club: its id and name, a name alone, or none. */
function club(value: unknown): NormalisedTransferClub | null {
  const v = rec(value);
  const name = plain(v.name);
  if (name === null) return null;
  return { externalId: id(v.id), name };
}

/**
 * Both `/transfers` answers: one entry per player, each with the moves the
 * provider lists. A move is kept when it has a real day and two different
 * clubs, or one club and none. Quirks of the answers, read 2026-10-21:
 *  - a "Free agent" move sometimes names the player himself, without an id,
 *    as the club he went to ("Stones John"): a side without an id on a free
 *    agent's move is no club;
 *  - a "Raise" from a club to itself is a youth player promoted, not a move,
 *    and is left out with every other move whose two sides are one club;
 *  - a side is sometimes a name without an id ("Internazionale"), kept as a
 *    name: shown as text, never matched to a club of ours.
 * A move listed twice (same player, day and clubs) counts once. Newest first.
 */
export function mapTransfers(response: unknown): NormalisedTransfer[] {
  if (!Array.isArray(response)) return [];
  const out: NormalisedTransfer[] = [];
  const seen = new Set<string>();
  for (const item of response) {
    const it = rec(item);
    const p = rec(it.player);
    const playerId = id(p.id);
    const playerName = plain(p.name);
    if (playerId === null || playerName === null || !Array.isArray(it.transfers)) continue;
    const player: EntityRef = { externalId: playerId, name: playerName };
    for (const move of it.transfers) {
      const m = rec(move);
      const date = day(m.date);
      if (date === null) continue;
      const teams = rec(m.teams);
      const { kind, fee } = transferKind(m.type);
      const freeAgent = typeof m.type === 'string' && /^\s*free agent\s*$/i.test(m.type);
      let from = club(teams.out);
      let to = club(teams.in);
      if (freeAgent && to?.externalId === null) to = null;
      if (freeAgent && from?.externalId === null) from = null;
      if (from === null && to === null) continue;
      if (sameClub(from, to)) continue;
      const key = `${playerId}|${date}|${clubKey(from)}|${clubKey(to)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ player, date, kind, fee, from, to });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

function clubKey(c: NormalisedTransferClub | null): string {
  if (c === null) return '-';
  return c.externalId === null ? `name:${c.name.toLowerCase()}` : `id:${c.externalId}`;
}

function sameClub(a: NormalisedTransferClub | null, b: NormalisedTransferClub | null): boolean {
  return a !== null && b !== null && clubKey(a) === clubKey(b);
}
