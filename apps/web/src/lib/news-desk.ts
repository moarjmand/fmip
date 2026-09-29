import type { AuditRecord, BreakingRecord, DebateRecord, StoryType } from '@fmip/contracts';
import { isStoryType } from '@fmip/contracts';

/**
 * The news desk's record of one story (T-1009, rule 10): every editor's
 * decision about it, newest first, read from the lists the API already
 * keeps -- the debate selections and the breaking marks, each with who,
 * when, the note and the reason -- and, for an administrator, the story's
 * type changes from the audit log with the label each one replaced. An
 * editor cannot read the audit log (T-070), so for them the type's earlier
 * labels are named as not shown rather than left out silently.
 */

export type DeskEventKind =
  | 'debate_selected'
  | 'debate_cleared'
  | 'breaking_marked'
  | 'breaking_cleared'
  | 'breaking_expired'
  | 'type_labelled';

export interface DeskEvent {
  kind: DeskEventKind;
  at: string;
  /** Who did it; `null` for a mark whose window ran out. */
  by: string | null;
  /** The note readers saw or the reason recorded; `null` for an expiry. */
  words: string | null;
  /** A type change: the label replaced (`null` when there was none) and the new one. */
  type?: { previous: StoryType | null; next: StoryType };
}

function typeOf(value: unknown): StoryType | null {
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && isStoryType(type) ? type : null;
}

export function storyHistory(
  storyId: string,
  debates: readonly DebateRecord[],
  marks: readonly BreakingRecord[],
  audit: readonly AuditRecord[] | null,
): DeskEvent[] {
  const events: DeskEvent[] = [];
  for (const d of debates) {
    if (d.story_id !== storyId) continue;
    events.push({ kind: 'debate_selected', at: d.selected_at, by: d.selected_by, words: d.note });
    if (d.cleared_at !== null) {
      events.push({
        kind: 'debate_cleared',
        at: d.cleared_at,
        by: d.cleared_by,
        words: d.cleared_reason,
      });
    }
  }
  for (const m of marks) {
    if (m.story_id !== storyId) continue;
    events.push({ kind: 'breaking_marked', at: m.marked_at, by: m.marked_by, words: m.note });
    if (m.state === 'cleared' && m.cleared_at !== null) {
      events.push({
        kind: 'breaking_cleared',
        at: m.cleared_at,
        by: m.cleared_by,
        words: m.cleared_reason,
      });
    } else if (m.state === 'expired') {
      events.push({ kind: 'breaking_expired', at: m.ends_at, by: null, words: null });
    }
  }
  for (const row of audit ?? []) {
    if (row.target_type !== 'story' || row.target_id !== storyId || row.action !== 'story.type') {
      continue;
    }
    const next = typeOf(row.next);
    if (next === null) continue;
    events.push({
      kind: 'type_labelled',
      at: row.created_at,
      by: row.actor.username,
      words: row.reason,
      type: { previous: typeOf(row.previous), next },
    });
  }
  // Newest first; on a tie the entry recorded later comes first (a clear above its selection).
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at) || b.index - a.index)
    .map(({ event }) => event);
}

/** The desk's words for each kind of decision. */
export const DESK_EVENT_LABEL: Record<DeskEventKind, string> = {
  debate_selected: 'Put on the debate page',
  debate_cleared: 'Taken off the debate page',
  breaking_marked: 'Marked breaking',
  breaking_cleared: 'Breaking mark cleared',
  breaking_expired: 'Breaking mark ran out',
  type_labelled: 'Type given',
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A story's id from what an editor pastes: the id itself or a story page's address. */
export function storyIdFrom(given: string | undefined): string | null {
  return UUID.exec(given ?? '')?.[0]?.toLowerCase() ?? null;
}
