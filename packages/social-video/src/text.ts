import type { ClipLocale, ClipTeam, Localised, MatchdayPreviewProps, Outcome } from './props.ts';

/**
 * The preview's words, pure: no clock, no host locale, no host time zone.
 * English follows the social card (`apps/web/src/lib/social-card.ts`):
 * London time, "UK time", the shares as the forecast holds them. Persian
 * follows the site's Persian pages: Tehran time, the Persian calendar and
 * Persian digits.
 */

const ZONE = { en: 'Europe/London', fa: 'Asia/Tehran' } as const;

export const pick = (value: Localised, locale: ClipLocale): string =>
  locale === 'fa' ? (value.fa ?? value.en) : value.en;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
/** ASCII digits as Persian ones, the decimal point as the Persian separator. */
export function persianDigits(value: string): string {
  return value
    .replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d)
    .replace(/(?<=[۰-۹])\.(?=[۰-۹])/g, '٫');
}

/** A team's badge as the card letters it: the code, else two initials. */
export function badgeLetters(team: ClipTeam): string {
  const code = team.code?.trim() ?? '';
  if (/^[\p{L}\p{N}]{3}$/u.test(code)) return code.toLocaleUpperCase('en');
  const words = team.name.en.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? `${Array.from(words[0] ?? '')[0] ?? ''}${Array.from(words[1] ?? '')[0] ?? ''}`
      : Array.from(words[0] ?? '')
          .slice(0, 2)
          .join('');
  return letters.toLocaleUpperCase('en');
}

/** One decimal when any share has one, as the card prints them. */
export function shareDecimals(percent: Record<Outcome, number>): 0 | 1 {
  return [percent.home, percent.draw, percent.away].some((p) => !Number.isInteger(p)) ? 1 : 0;
}

/** "24.8" or "۲۴٫۸". */
export function shareText(value: number, decimals: 0 | 1, locale: ClipLocale): string {
  const fixed = value.toFixed(decimals);
  return locale === 'fa' ? persianDigits(fixed) : fixed;
}

/** Equal shares share a rank: two equal largest are both the model's colour. */
export function shareRank(percent: Record<Outcome, number>, outcome: Outcome): 1 | 2 | 3 {
  const above = (['home', 'draw', 'away'] as const).filter((o) => percent[o] > percent[outcome]);
  return (1 + above.length) as 1 | 2 | 3;
}

/** "Thu 19 Nov · 13:00 UK time" / "پنجشنبه ۲۸ آبان · ۱۶:۳۰ به وقت تهران". */
export function kickOffText(iso: string, locale: ClipLocale): string {
  const at = new Date(iso);
  if (locale === 'fa') {
    const day = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: ZONE.fa,
    }).format(at);
    const clock = new Intl.DateTimeFormat('fa-IR-u-nu-arabext', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: ZONE.fa,
    }).format(at);
    return `${day} · ${clock} به وقت تهران`;
  }
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: ZONE.en,
  })
    .format(at)
    .replace(',', '');
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ZONE.en,
  }).format(at);
  return `${day} · ${clock} UK time`;
}

/** "Computed 13 Nov, 09:55 UK time": always Latin, it is the model's receipt line. */
export function computedText(iso: string): string {
  const stamp = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: ZONE.en,
  }).format(new Date(iso));
  return `Computed ${stamp} UK time`;
}

/**
 * The countdown at a frame: whole seconds from `as_of` plus the frame's time
 * to kick-off, as "05:59:45" (hours may pass 99; never below zero).
 */
export function countdownText(
  props: Pick<MatchdayPreviewProps, 'as_of' | 'kickoff_at'>,
  frame: number,
  fps: number,
  locale: ClipLocale,
): string {
  const now = Date.parse(props.as_of) + Math.floor(frame / fps) * 1000;
  const left = Math.max(0, Math.floor((Date.parse(props.kickoff_at) - now) / 1000));
  const two = (n: number): string => String(n).padStart(2, '0');
  const clock = `${two(Math.floor(left / 3600))}:${two(Math.floor(left / 60) % 60)}:${two(left % 60)}`;
  return locale === 'fa' ? persianDigits(clock) : clock;
}

/** The fixed words of the preview in each language. */
export const WORDS = {
  en: {
    chip: 'MODEL FORECAST',
    versus: 'v',
    draw: 'Draw',
    countdown: 'Kick-off in',
    percent: '%',
  },
  fa: {
    chip: 'پیش‌بینی مدل آماری',
    versus: '–',
    draw: 'مساوی',
    countdown: 'تا شروع بازی',
    percent: '٪',
  },
} as const;
