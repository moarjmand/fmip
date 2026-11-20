import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  interpolateColors,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  parseClipProps,
  type ClipTeam,
  type MatchdayPreviewProps,
  type Outcome,
} from '../props.ts';
import {
  WORDS,
  badgeLetters,
  computedText,
  countdownText,
  kickOffText,
  pick,
  shareDecimals,
  shareRank,
  shareText,
} from '../text.ts';
import {
  BLACK,
  MARK_BARS,
  MARK_NIGHT,
  MONO,
  NARROW,
  NIGHT,
  PERSIAN,
  RANK_OPACITY,
  SANS,
} from '../tokens.ts';

/**
 * Format 1, the matchday preview (T-1931's representative composition; the
 * product's own is T-1935): the social card's forecast layout in motion.
 * Type, numbers, a bar and the wordmark -- no crest, logo or photo. Turquoise
 * is the model's colour and nothing else's (rule 6), and the model is named
 * on the frame with its version whenever its figures are.
 *
 * Every value drawn is a function of the frame number and the props: no
 * clock, no randomness, no spring with hidden state. Layout uses logical
 * properties and `dir` only, so the Persian clip mirrors by itself; the one
 * physical value is the sign of a slide's `translateX`, flipped by `dir`.
 */

const PAD = 72;
const OUTCOMES = ['home', 'draw', 'away'] as const;
const ALIGN = ['flex-start', 'center', 'flex-end'] as const;
const TEXT_ALIGN = ['start', 'center', 'end'] as const;

/** When each part arrives, in frames at 30 a second. */
const AT = {
  header: 0,
  eyebrow: 10,
  home: 24,
  away: 36,
  kickOff: 66,
  countdown: 90,
  model: 132,
  bar: { home: 156, draw: 196, away: 236 },
  fill: 44,
  rank: 286,
} as const;

const ease = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0 before `start`, 1 after `start + frames`, eased. */
const progress = (frame: number, start: number, frames = 18): number =>
  interpolate(frame, [start, start + frames], [0, 1], { ...clamp, easing: ease });

const row = (style: CSSProperties = {}): CSSProperties => ({ display: 'flex', ...style });
const column = (style: CSSProperties = {}): CSSProperties =>
  row({ flexDirection: 'column', ...style });

/** A part that fades in and rises into place. */
function Rise({
  at,
  children,
  style,
}: {
  at: number;
  children: ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const p = progress(useCurrentFrame(), at);
  return (
    <div style={{ ...style, opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>
      {children}
    </div>
  );
}

function Mark({ size }: { size: number }): ReactElement {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {MARK_BARS.map(({ y, width, colour }) => (
        <rect key={colour} x={3} y={y} width={width} height={4} rx={2} fill={MARK_NIGHT[colour]} />
      ))}
    </svg>
  );
}

function Team({
  team,
  name,
  at,
  from,
  size,
  face,
}: {
  team: ClipTeam;
  name: string;
  at: number;
  /** The side the team slides in from, as a sign on the x axis. */
  from: 1 | -1;
  size: number;
  face: string;
}): ReactElement {
  const p = progress(useCurrentFrame(), at, 22);
  const longest = Math.max(...name.split(/\s+/).map((word) => word.length));
  const nameSize = name.length <= 10 ? 60 : longest <= 12 ? 50 : 42;
  return (
    <div
      style={column({
        inlineSize: 400,
        alignItems: 'center',
        gap: 24,
        opacity: p,
        transform: `translateX(${from * (1 - p) * 80}px)`,
      })}
    >
      <div
        style={row({
          inlineSize: size,
          blockSize: size,
          borderRadius: Math.round(size * 0.18),
          border: `4px solid ${NIGHT.border}`,
          background: NIGHT.surface,
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: Math.round(size * 0.36),
          letterSpacing: 2,
        })}
      >
        {badgeLetters(team)}
      </div>
      <div
        style={{
          inlineSize: 400,
          minBlockSize: Math.ceil(nameSize * 1.2 * 2),
          textAlign: 'center',
          fontFamily: face,
          fontSize: nameSize,
          fontWeight: 800,
          lineHeight: 1.2,
        }}
      >
        {name}
      </div>
    </div>
  );
}

export function MatchdayPreview(input: MatchdayPreviewProps): ReactElement {
  // Refused here as well as before the render: no path draws a forbidden clip.
  const props = parseClipProps(input);
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames } = useVideoConfig();

  const locale = props.locale;
  const fa = locale === 'fa';
  const words = WORDS[locale];
  const face = fa ? PERSIAN : SANS;
  const receipt = fa ? PERSIAN : MONO;
  const tall = height > 1500;
  const u = tall ? 1.15 : 1;
  const slide = fa ? -1 : 1;

  const percent = props.prediction.percent;
  const decimals = shareDecimals(percent);
  const fill: Record<Outcome, number> = {
    home: progress(frame, AT.bar.home, AT.fill),
    draw: progress(frame, AT.bar.draw, AT.fill),
    away: progress(frame, AT.bar.away, AT.fill),
  };
  const ranked = progress(frame, AT.rank, 24);
  const barWidth = 1080 - 2 * PAD - 12;
  const { model } = props.prediction;
  const names: Record<Outcome, string> = {
    home: pick(props.home.name, locale),
    draw: words.draw,
    away: pick(props.away.name, locale),
  };
  const eyebrow = [
    props.competition.name,
    ...(props.competition.round ? [props.competition.round] : []),
  ]
    .map((part) => pick(part, locale))
    .join(' · ');

  return (
    <AbsoluteFill
      dir={fa ? 'rtl' : 'ltr'}
      lang={locale}
      style={column({
        background: NIGHT.canvas,
        color: NIGHT.text,
        fontFamily: face,
        paddingInline: PAD,
        paddingBlockStart: tall ? 220 : PAD,
        paddingBlockEnd: tall ? 300 : PAD,
        justifyContent: 'space-between',
      })}
    >
      <div style={column({ gap: 40 })}>
        <Rise at={AT.header} style={row({ alignItems: 'center', justifyContent: 'space-between' })}>
          <div dir="ltr" style={row({ alignItems: 'center', gap: 20 })}>
            <Mark size={64} />
            <div style={{ fontFamily: BLACK, fontWeight: 900, fontSize: 30, letterSpacing: 1 }}>
              STADIOMIND
            </div>
          </div>
          <div
            style={row({
              blockSize: 56,
              alignItems: 'center',
              paddingInline: 24,
              borderRadius: 28,
              border: `2px solid ${NIGHT.model}`,
              color: NIGHT.model,
              fontFamily: receipt,
              fontSize: 24,
            })}
          >
            {words.chip}
          </div>
        </Rise>
        <Rise
          at={AT.eyebrow}
          style={{
            fontFamily: receipt,
            fontSize: fa ? 34 : 28,
            color: NIGHT.accent,
            letterSpacing: fa ? 0 : 1,
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </Rise>
      </div>

      <div style={column({ alignItems: 'center', gap: 36 * u })}>
        <div style={row({ inlineSize: '100%', justifyContent: 'space-between' })}>
          <Team
            team={props.home}
            name={names.home}
            at={AT.home}
            from={slide === 1 ? -1 : 1}
            size={Math.round(200 * u)}
            face={face}
          />
          <Rise
            at={AT.away}
            style={row({
              blockSize: Math.round(200 * u),
              alignItems: 'center',
              fontSize: 40,
              fontWeight: 700,
              color: NIGHT.caption,
            })}
          >
            {words.versus}
          </Rise>
          <Team
            team={props.away}
            name={names.away}
            at={AT.away}
            from={slide}
            size={Math.round(200 * u)}
            face={face}
          />
        </div>
        <Rise at={AT.kickOff} style={{ fontSize: 44 * u, fontWeight: 700 }}>
          {kickOffText(props.kickoff_at, locale)}
        </Rise>
        <Rise at={AT.countdown} style={column({ alignItems: 'center', gap: 8 })}>
          <div
            style={{
              fontFamily: receipt,
              fontSize: 26 * u,
              color: NIGHT.caption,
              letterSpacing: fa ? 0 : 1,
            }}
          >
            {fa ? words.countdown : words.countdown.toLocaleUpperCase('en')}
          </div>
          <div
            dir="ltr"
            style={{
              fontFamily: fa ? PERSIAN : MONO,
              fontSize: 76 * u,
              fontWeight: fa ? 700 : 400,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              color: NIGHT.accent,
            }}
          >
            {countdownText(props, frame, fps, locale)}
          </div>
        </Rise>
      </div>

      <div style={column({ gap: 28 })}>
        <div style={row({ inlineSize: '100%', blockSize: 56 * u, gap: 6 })}>
          {OUTCOMES.map((outcome, i) => (
            <div
              key={outcome}
              style={{
                inlineSize: (barWidth * percent[outcome] * fill[outcome]) / 100,
                blockSize: '100%',
                background: NIGHT.model,
                opacity: interpolate(
                  ranked,
                  [0, 1],
                  [1, RANK_OPACITY[shareRank(percent, outcome)]],
                ),
                borderStartStartRadius: i === 0 ? 12 : 0,
                borderEndStartRadius: i === 0 ? 12 : 0,
                borderStartEndRadius: i === 2 ? 12 : 0,
                borderEndEndRadius: i === 2 ? 12 : 0,
              }}
            />
          ))}
        </div>
        <div style={row({ inlineSize: '100%' })}>
          {OUTCOMES.map((outcome, i) => {
            const first = shareRank(percent, outcome) === 1;
            return (
              <div
                key={outcome}
                style={column({
                  flexGrow: 1,
                  flexBasis: 0,
                  alignItems: ALIGN[i],
                  gap: 6,
                  opacity: progress(frame, AT.bar[outcome] - 6, 12),
                })}
              >
                <div
                  style={row({
                    alignItems: 'flex-start',
                    fontFamily: fa ? PERSIAN : NARROW,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: interpolateColors(
                      ranked,
                      [0, 1],
                      [NIGHT.text, first ? NIGHT.model : NIGHT['text-muted']],
                    ),
                  })}
                >
                  {/* Persian figures are wider (five glyphs and the momayyez): one size, both aspects. */}
                  <div style={{ fontSize: fa ? 100 : 128 * u, lineHeight: 1 }}>
                    {shareText(percent[outcome] * fill[outcome], decimals, locale)}
                  </div>
                  <div
                    style={{ fontSize: fa ? 44 : 54 * u, marginBlockStart: 10 * u, lineHeight: 1 }}
                  >
                    {words.percent}
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: receipt,
                    fontSize: fa ? 30 : 26,
                    color: NIGHT.caption,
                    textAlign: TEXT_ALIGN[i],
                    maxInlineSize: 300,
                    textTransform: 'uppercase',
                  }}
                >
                  {names[outcome]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={column({ gap: 22 })}>
        <Rise
          at={AT.model}
          style={column({
            gap: 10,
            paddingBlockStart: 28,
            borderBlockStart: `2px solid ${NIGHT.border}`,
            fontFamily: MONO,
          })}
        >
          <div
            dir="ltr"
            style={{ fontSize: 30, color: NIGHT.model, textAlign: fa ? 'end' : 'start' }}
          >
            {`${model.name}@${model.version}`}
          </div>
          <div
            dir="ltr"
            style={{ fontSize: 22, color: NIGHT.caption, textAlign: fa ? 'end' : 'start' }}
          >
            {computedText(model.computed_at)}
          </div>
        </Rise>
        <div style={{ fontFamily: receipt, fontSize: fa ? 26 : 22, color: NIGHT.caption }}>
          {pick(props.disclosure, locale)}
        </div>
        <div style={row({ blockSize: 4, background: NIGHT.border, borderRadius: 2 })}>
          <div
            style={{
              inlineSize: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
              background: NIGHT.accent,
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}
