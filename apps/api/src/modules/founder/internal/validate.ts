/**
 * Validating a published analysis (T-131).
 *
 * Pure, and deliberately not a schema library: the rules are few, they are the
 * blueprint's, and every message here is one a person reads while writing. The
 * database enforces the same rules again — this layer exists so the founder gets
 * a sentence instead of a constraint name, not so the database can relax.
 *
 * Every field is reported at once. A form that rejects one problem at a time is
 * a form that gets abandoned halfway through.
 */

export interface PublishRequest {
  predicted_outcome: 'home' | 'draw' | 'away';
  predicted_score: { home: number; away: number } | null;
  confidence: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
  lineup_impact: string | null;
  key_players: string | null;
  form_and_context: string | null;
}

export const OUTCOMES = ['home', 'draw', 'away'] as const;
export const MIN_REASONING = 40;
export const MAX_SECTION = 4000;

type Parsed = { value: PublishRequest } | { fields: Record<string, string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed text, or `null` for an absent or empty optional section. */
function optional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function validatePublish(body: unknown): Parsed {
  const fields: Record<string, string> = {};
  if (!isRecord(body)) return { fields: { body: 'must be an object' } };

  const outcome = body.predicted_outcome;
  if (typeof outcome !== 'string' || !(OUTCOMES as readonly string[]).includes(outcome)) {
    fields.predicted_outcome = `must be one of ${OUTCOMES.join(', ')}`;
  }

  const confidence = body.confidence;
  if (
    typeof confidence !== 'number' ||
    !Number.isInteger(confidence) ||
    confidence < 1 ||
    confidence > 5
  ) {
    fields.confidence = 'must be a whole number from 1 to 5';
  }

  const reasoning = typeof body.reasoning === 'string' ? body.reasoning.trim() : '';
  if (reasoning.length < MIN_REASONING) {
    // The one substantive rule: an analysis is the reasoning. A sentence
    // fragment beside a predicted score is a prediction, and the product
    // already has those — letting one through as an analysis would blur the
    // distinction rule 6 exists to keep.
    fields.reasoning = `must be at least ${MIN_REASONING} characters: an analysis is the reasoning`;
  } else if (reasoning.length > MAX_SECTION) {
    fields.reasoning = `must be at most ${MAX_SECTION} characters`;
  }

  let score: { home: number; away: number } | null = null;
  const raw = body.predicted_score;
  if (raw !== undefined && raw !== null) {
    if (
      !isRecord(raw) ||
      typeof raw.home !== 'number' ||
      typeof raw.away !== 'number' ||
      !Number.isInteger(raw.home) ||
      !Number.isInteger(raw.away) ||
      raw.home < 0 ||
      raw.away < 0
    ) {
      fields.predicted_score = 'must be two whole goal counts, or absent';
    } else {
      score = { home: raw.home, away: raw.away };
      const implied = score.home > score.away ? 'home' : score.home < score.away ? 'away' : 'draw';
      if (typeof outcome === 'string' && implied !== outcome) {
        // Two different calls in one submission; the page would have to pick.
        fields.predicted_score = `says ${implied}, but the predicted outcome is ${String(outcome)}`;
      }
    }
  }

  for (const key of ['lineup_impact', 'key_players', 'form_and_context'] as const) {
    const text = optional(body[key]);
    if (text !== null && text.length > MAX_SECTION) {
      fields[key] = `must be at most ${MAX_SECTION} characters`;
    }
  }

  if (Object.keys(fields).length > 0) return { fields };

  return {
    value: {
      predicted_outcome: outcome as PublishRequest['predicted_outcome'],
      predicted_score: score,
      confidence: confidence as PublishRequest['confidence'],
      reasoning,
      lineup_impact: optional(body.lineup_impact),
      key_players: optional(body.key_players),
      form_and_context: optional(body.form_and_context),
    },
  };
}
