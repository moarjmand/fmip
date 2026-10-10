import { INCIDENT_DETAILS, type IncidentDetail, type IncidentKind } from '../normalised';

/**
 * A provider's incident detail in our words (T-1378, D-196, rule 2).
 *
 * The providers spell out a detail beside an event's type: API-Football's
 * "Normal Goal", "Penalty", "Own Goal", "Missed Penalty", "Yellow Card",
 * "Red card", "Second Yellow card", "Substitution 1" and, for a VAR review,
 * "Goal cancelled", "Goal Disallowed - offside", "Penalty confirmed";
 * Highlightly's event type is the same kind of text. Only what a VAR review
 * decided adds anything to our kind: every other detail repeats the kind the
 * page already names, so it is no detail. A detail we cannot name is none --
 * the page shows the kind ("Goal", "VAR") and never the provider's text.
 *
 * One of our own codes maps to itself, so the API can map a stored row at read
 * time whether it was written before T-1378 (the provider's text) or after
 * (our code), without a backfill.
 */
export function incidentDetail(kind: IncidentKind, raw: unknown): IncidentDetail | null {
  if (kind !== 'var' || typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  if ((INCIDENT_DETAILS as readonly string[]).includes(text)) return text as IncidentDetail;
  switch (subjectOf(text)) {
    case 'goal':
      if (/cancel|disallow|overturn|ruled out|no goal|offside|foul|handball/.test(text)) {
        return 'goal_cancelled';
      }
      if (/confirm|stand|allow|award|given/.test(text)) return 'goal_confirmed';
      return null;
    case 'penalty':
      if (/cancel|overturn|disallow|not awarded|no penalty|withdrawn|revoked/.test(text)) {
        return 'penalty_cancelled';
      }
      if (/confirm|stand/.test(text)) return 'penalty_confirmed';
      if (/award|given/.test(text)) return 'penalty_awarded';
      return null;
    case 'card':
      if (/upgrade/.test(text)) return 'card_upgraded';
      if (/cancel|rescind|downgrade|overturn|withdrawn|revoked/.test(text)) {
        return 'card_cancelled';
      }
      return null;
    default:
      return null;
  }
}

/** What a VAR text is about: whichever of goal, penalty or card it names first. */
function subjectOf(text: string): 'goal' | 'penalty' | 'card' | null {
  let first: { subject: 'goal' | 'penalty' | 'card'; at: number } | null = null;
  for (const subject of ['goal', 'penalty', 'card'] as const) {
    const at = text.indexOf(subject);
    if (at >= 0 && (first === null || at < first.at)) first = { subject, at };
  }
  return first?.subject ?? null;
}
