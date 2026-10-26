import { describe, expect, it } from 'vitest';
import { ABSENCE_REASONS } from '../normalised';
import { absenceReason } from './_absence-reason';

/**
 * T-1601: every reason API-Football gave on production (2026-10-26, 56 texts
 * over 3,415 absences) in our words, so a Persian page never shows the
 * provider's English.
 */
describe('an absence reason in our words (T-1601)', () => {
  it('names every reason production holds', () => {
    const seen: [string, string][] = [
      ['Knee Injury', 'knee'],
      ['Muscle Injury', 'muscle'],
      ['Injury', 'injury'],
      ['Inactive', 'inactive'],
      ['Off the roster', 'off_roster'],
      ['Thigh Injury', 'thigh'],
      ['Ankle Injury', 'ankle'],
      ['Hamstring Injury', 'hamstring'],
      ['Foot Injury', 'foot'],
      ['Groin Injury', 'groin'],
      ['Calf Injury', 'calf'],
      ['Red Card', 'red_card'],
      ['Leg Injury', 'leg'],
      ['Shoulder Injury', 'shoulder'],
      ['Achilles Tendon Injury', 'achilles'],
      ['Lower-Body Injury', 'lower_body'],
      ['Knock', 'knock'],
      ['Yellow Cards', 'yellow_cards'],
      ['Back Injury', 'back'],
      ['Illness', 'illness'],
      ['Hip Injury', 'hip'],
      ['Broken Leg', 'fracture'],
      ['Health problems', 'health'],
      ['Lacking Match Fitness', 'lacking_fitness'],
      ['Surgery', 'surgery'],
      ["Coach's decision", 'coach_decision'],
      ['Abdominal strain', 'abdomen'],
      ['Concussion', 'concussion'],
      ['Rest', 'rest'],
      ['Suspended', 'suspended'],
      ['Toe Injury', 'toe'],
      ['Wrist Injury', 'wrist'],
      ['Chest Injury', 'chest'],
      ['Upper-Body Injury', 'upper_body'],
      ['Arm Injury', 'arm'],
      ['Hernia', 'hernia'],
      ['Personal Reasons', 'personal'],
      ['Overload', 'overload'],
      ['Eye injury', 'eye'],
      ['Heart Problems', 'heart'],
      ['Broken calfbone', 'fracture'],
      ['Broken Hand', 'fracture'],
      ['Heel Injury', 'heel'],
      ['Collarbone injury', 'collarbone'],
      ['Hand Injury', 'hand'],
      ['Broken shinbone', 'fracture'],
      ['Head Injury', 'head'],
      ['Doping', 'doping'],
      ['Lower Back Injury', 'back'],
      ['Loan agreement', 'loan_agreement'],
      ['Tendon Injury', 'tendon'],
      ['Pelvis Injury', 'pelvis'],
      ['Jumpers Knee', 'knee'],
      ['Contusion', 'knock'],
      ['Broken jawbone', 'fracture'],
      ['Ribs Injury', 'ribs'],
    ];
    for (const [text, code] of seen) expect([text, absenceReason(text)]).toEqual([text, code]);
  });

  it('names nothing it cannot read, rather than guessing', () => {
    expect(absenceReason(null)).toBeNull();
    expect(absenceReason('')).toBeNull();
    expect(absenceReason('Unknown')).toBeNull();
    expect(absenceReason(42)).toBeNull();
  });

  it('reads each of our own codes as itself', () => {
    for (const code of ABSENCE_REASONS) expect(absenceReason(code)).toBe(code);
  });
});
