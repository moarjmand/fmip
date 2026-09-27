import { describe, expect, it } from 'vitest';
import {
  validateUpdatePreferences,
  validateUpdatePrivacy,
  validateUpdateProfile,
} from './internal/validation';
import { canView } from './internal/visibility';

const OWNER = 'owner';
const OTHER = 'other';

describe('canView', () => {
  it('always lets the owner see their own profile', () => {
    expect(canView('private', OWNER, OWNER, false)).toBe(true);
    expect(canView('friends', OWNER, OWNER, false)).toBe(true);
  });

  it('public: anyone, including a signed-out viewer', () => {
    expect(canView('public', OWNER, null, false)).toBe(true);
    expect(canView('public', OWNER, OTHER, false)).toBe(true);
  });

  it('friends: only a signed-in friend', () => {
    expect(canView('friends', OWNER, null, false)).toBe(false);
    expect(canView('friends', OWNER, OTHER, false)).toBe(false);
    expect(canView('friends', OWNER, OTHER, true)).toBe(true);
    // A signed-out viewer is nobody's friend, whatever the oracle says.
    expect(canView('friends', OWNER, null, true)).toBe(false);
  });

  it('private: nobody but the owner, friend or not', () => {
    expect(canView('private', OWNER, null, false)).toBe(false);
    expect(canView('private', OWNER, OTHER, false)).toBe(false);
    expect(canView('private', OWNER, OTHER, true)).toBe(false);
  });
});

describe('validateUpdateProfile', () => {
  it('distinguishes absent, null and a value', () => {
    expect(validateUpdateProfile({ bio: null })).toEqual({ ok: true, value: { bio: null } });
    expect(validateUpdateProfile({ bio: '  hello  ' })).toEqual({
      ok: true,
      value: { bio: 'hello' },
    });
    expect(validateUpdateProfile({ bio: '   ' })).toEqual({ ok: true, value: { bio: null } });
    expect(validateUpdateProfile({})).toEqual({ ok: false, fields: { body: 'nothing to update' } });
  });

  it('names each failing field', () => {
    const result = validateUpdateProfile({
      display_name: '',
      bio: 'x'.repeat(501),
      avatar_url: 'ftp://nope',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual(['avatar_url', 'bio', 'display_name']);
    }
  });
});

describe('validateUpdatePrivacy', () => {
  it('accepts the three levels and nothing else', () => {
    expect(validateUpdatePrivacy({ profile_visibility: 'friends' })).toEqual({
      ok: true,
      value: { profile_visibility: 'friends' },
    });
    expect(validateUpdatePrivacy({ prediction_history_visibility: 'secret' })).toEqual({
      ok: false,
      fields: { prediction_history_visibility: 'must be one of public, friends, private' },
    });
  });
});

describe('validateUpdatePreferences (T-620)', () => {
  it('takes a language tag and an IANA zone, trimmed, and nothing it was not given', () => {
    expect(validateUpdatePreferences({ timezone: ' Asia/Tehran ' })).toEqual({
      ok: true,
      value: { timezone: 'Asia/Tehran' },
    });
    expect(validateUpdatePreferences({ preferred_language: 'pt-BR', timezone: 'UTC' })).toEqual({
      ok: true,
      value: { preferred_language: 'pt-BR', timezone: 'UTC' },
    });
    expect(validateUpdatePreferences({})).toEqual({ ok: true, value: {} });
  });

  it('refuses what registration refuses, field by field', () => {
    expect(validateUpdatePreferences({ timezone: 'Mars/Olympus', preferred_language: 7 })).toEqual({
      ok: false,
      fields: {
        preferred_language: 'must be a language tag such as en',
        timezone: 'must be an IANA time zone such as Asia/Tehran',
      },
    });
    expect(validateUpdatePreferences(null)).toEqual({
      ok: false,
      fields: { body: 'must be a JSON object' },
    });
  });
});

describe('validateUpdatePreferences: the theme (T-602)', () => {
  it('takes light, dark or system, alone or beside the other fields', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      expect(validateUpdatePreferences({ theme })).toEqual({ ok: true, value: { theme } });
    }
    expect(validateUpdatePreferences({ theme: 'dark', timezone: 'UTC' })).toEqual({
      ok: true,
      value: { timezone: 'UTC', theme: 'dark' },
    });
  });

  it('refuses anything else, including a different case, and says what it takes', () => {
    for (const theme of ['Dark', 'sepia', '', null, 1, ['dark']]) {
      expect(validateUpdatePreferences({ theme })).toEqual({
        ok: false,
        fields: { theme: 'must be one of light, dark, system' },
      });
    }
  });
});

describe('validateUpdatePreferences: text size, contrast and motion (T-621)', () => {
  it('takes each of its own values, alone or together with the theme', () => {
    for (const text_size of ['default', 'large', 'larger'] as const) {
      expect(validateUpdatePreferences({ text_size })).toEqual({ ok: true, value: { text_size } });
    }
    for (const contrast of ['system', 'standard', 'more'] as const) {
      expect(validateUpdatePreferences({ contrast })).toEqual({ ok: true, value: { contrast } });
    }
    for (const motion of ['system', 'reduce'] as const) {
      expect(validateUpdatePreferences({ motion })).toEqual({ ok: true, value: { motion } });
    }
    expect(
      validateUpdatePreferences({
        theme: 'dark',
        text_size: 'larger',
        contrast: 'more',
        motion: 'reduce',
      }),
    ).toEqual({
      ok: true,
      value: { theme: 'dark', text_size: 'larger', contrast: 'more', motion: 'reduce' },
    });
  });

  it('refuses anything else, field by field, and says what each takes', () => {
    for (const bad of ['Large', 'huge', '', null, 2, ['large']]) {
      expect(validateUpdatePreferences({ text_size: bad, contrast: bad, motion: bad })).toEqual({
        ok: false,
        fields: {
          text_size: 'must be one of default, large, larger',
          contrast: 'must be one of system, standard, more',
          motion: 'must be one of system, reduce',
        },
      });
    }
    // A good field beside a bad one is not half-applied: the whole body is refused.
    expect(validateUpdatePreferences({ text_size: 'large', contrast: 'high' })).toEqual({
      ok: false,
      fields: { contrast: 'must be one of system, standard, more' },
    });
  });
});
