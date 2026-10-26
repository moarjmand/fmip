import { ABSENCE_REASONS, type AbsenceReason } from '../normalised';

/**
 * The words a provider gives for an absence, as our code (T-1601, rule 2).
 *
 * API-Football writes the reason in English: "Knee Injury", "Hamstring
 * Injury", "Red Card", "Yellow Cards", "Inactive", "Coach's decision",
 * "Rest". Read in order: what is not about a body part first (a card, a
 * break, an operation), then the body part, then a bare "Injury". A reason
 * this cannot name is `null`, never a guess; the page then says the kind.
 *
 * One of our own codes maps to itself, so the API maps a stored row at read
 * time, whatever was written, without a backfill (as `incidentDetail`).
 */
const RULES: readonly [RegExp, AbsenceReason][] = [
  [/\bred card/, 'red_card'],
  [/\byellow card/, 'yellow_cards'],
  [/suspen/, 'suspended'],
  [/doping/, 'doping'],
  [/\bbroken\b|fracture/, 'fracture'],
  [/surgery|operation/, 'surgery'],
  [/concussion/, 'concussion'],
  [/hernia/, 'hernia'],
  [/\bknock\b|contusion|bruise/, 'knock'],
  [/illness|virus|\bsick|\bflu\b/, 'illness'],
  [/heart/, 'heart'],
  [/health/, 'health'],
  [/inactive/, 'inactive'],
  [/off the roster|not in squad|not registered/, 'off_roster'],
  [/match fitness|lack of fitness|lacking fitness/, 'lacking_fitness'],
  [/coach'?s decision|technical decision/, 'coach_decision'],
  [/\brest(ed|ing)?\b/, 'rest'],
  [/personal|family/, 'personal'],
  [/overload|fatigue/, 'overload'],
  [/\bloan\b/, 'loan_agreement'],
  [/international|national team/, 'international_duty'],
  [/lower[- ]body/, 'lower_body'],
  [/upper[- ]body/, 'upper_body'],
  [/achilles/, 'achilles'],
  [/hamstring/, 'hamstring'],
  [/\bknee\b/, 'knee'],
  [/\bthigh\b/, 'thigh'],
  [/\bgroin\b|adductor/, 'groin'],
  [/\bcalf\b/, 'calf'],
  [/\bankle\b/, 'ankle'],
  [/\bheel\b/, 'heel'],
  [/\btoe\b/, 'toe'],
  [/\bfoot\b/, 'foot'],
  [/\bhip\b/, 'hip'],
  [/pelvi/, 'pelvis'],
  [/\bback\b/, 'back'],
  [/abdom/, 'abdomen'],
  [/\bribs?\b/, 'ribs'],
  [/\bchest\b/, 'chest'],
  [/collarbone|clavicle/, 'collarbone'],
  [/\bshoulder\b/, 'shoulder'],
  [/\bwrist\b/, 'wrist'],
  [/\bhand\b|finger/, 'hand'],
  [/\barm\b|elbow/, 'arm'],
  [/\bhead\b|face|jaw|nose/, 'head'],
  [/\beye\b/, 'eye'],
  [/\bleg\b/, 'leg'],
  [/muscle/, 'muscle'],
  [/tendon/, 'tendon'],
  [/injur|strain|sprain|tear\b/, 'injury'],
];

export function absenceReason(raw: unknown): AbsenceReason | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase();
  if (text === '') return null;
  if ((ABSENCE_REASONS as readonly string[]).includes(text)) return text as AbsenceReason;
  for (const [pattern, reason] of RULES) if (pattern.test(text)) return reason;
  return null;
}
