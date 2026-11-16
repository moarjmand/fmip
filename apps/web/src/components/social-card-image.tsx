import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { SocialCardPayload } from '@fmip/contracts';
import { BrandMark } from '@/components/brand-mark';
import { FAILED_CARD_CACHE, drawCard } from '@/components/draw-card';
import {
  BLACK,
  CAPTION,
  GROUND,
  INK,
  MODEL,
  MONO,
  MUTED,
  NARROW,
  RULE,
  SAFFRON,
  SANS,
} from '@/components/share-card-image';
import { NIGHT_COLOURS } from '@/lib/brand-colours';
import { siteUrl } from '@/lib/seo';
import {
  SOCIAL_CARD_CACHE,
  SOCIAL_CARD_SIZE,
  socialCardText,
  type SocialBadge,
  type SocialCardText,
  type SocialForecastText,
  type SocialResultText,
  type SocialShare,
  type SocialVerdictText,
} from '@/lib/social-card';

/**
 * The social cards (T-1835, D-427 point 11), 1080 x 1350, for `next/og`:
 * inline styles and flexbox only, every box with more than one child
 * `display: flex`, no grid and no logical property (the renderer draws
 * none). Night only (D-351), in the bundled faces. No crest, logo or photo:
 * a team is a lettered badge (`badgeLetters`), and nothing here takes an
 * image address. Turquoise is the model's colour and nothing else's
 * (rule 6). The words come from `lib/social-card.ts`.
 */

const PAD = 72;
const SURFACE = NIGHT_COLOURS.surface;

const flex = (style: CSSProperties = {}): CSSProperties => ({ display: 'flex', ...style });

/** Opacity of a bar segment by its share's rank (D-368): full, three quarters, a half. */
const RANK_OPACITY = { 1: 1, 2: 0.75, 3: 0.5 } as const;

function Badge({ badge, size }: { badge: SocialBadge; size: number }): ReactElement {
  const count = Array.from(badge.letters).length;
  return (
    <div
      style={flex({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.round(size * 0.18),
        border: `4px solid ${RULE}`,
        background: SURFACE,
        color: INK,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: SANS,
        fontWeight: 800,
        fontSize: Math.round(size * (count > 2 ? 0.3 : 0.36)),
        letterSpacing: 2,
      })}
    >
      {badge.letters}
    </div>
  );
}

/** A badge over its team's name, the name held to two lines. */
function Team({ badge, size, width }: { badge: SocialBadge; size: number; width: number }) {
  const lineHeight = 1.12;
  return (
    <div style={flex({ width, flexDirection: 'column', alignItems: 'center', gap: 24 })}>
      <Badge badge={badge} size={size} />
      <div
        style={flex({
          width,
          height: Math.ceil(badge.nameSize * lineHeight * 2),
          justifyContent: 'center',
          alignItems: 'flex-start',
          textAlign: 'center',
          fontSize: badge.nameSize,
          fontWeight: 800,
          lineHeight,
        })}
      >
        {badge.name}
      </div>
    </div>
  );
}

function Header({ chip, model }: { chip: string; model: boolean }): ReactElement {
  return (
    <div style={flex({ alignItems: 'center', justifyContent: 'space-between' })}>
      <div style={flex({ alignItems: 'center', gap: 20 })}>
        <BrandMark size={64} ground="night" />
        <div style={flex({ fontFamily: BLACK, fontWeight: 900, fontSize: 30, letterSpacing: 1 })}>
          STADIOMIND
        </div>
      </div>
      <div
        style={flex({
          height: 56,
          alignItems: 'center',
          padding: '0 24px',
          borderRadius: 28,
          border: `2px solid ${model ? MODEL : RULE}`,
          color: model ? MODEL : MUTED,
          fontFamily: MONO,
          fontSize: 24,
        })}
      >
        {chip}
      </div>
    </div>
  );
}

function Eyebrow({ text }: { text: string }): ReactElement {
  return (
    <div style={flex({ fontFamily: MONO, fontSize: 28, color: SAFFRON, letterSpacing: 1 })}>
      {text}
    </div>
  );
}

/** The model named with its version (rule 6), when it computed, and the address. */
function ModelFooter({
  model,
  host,
}: {
  model: SocialForecastText['model'];
  host: string;
}): ReactElement {
  return (
    <div
      style={flex({
        flexDirection: 'column',
        gap: 10,
        paddingTop: 28,
        borderTop: `2px solid ${RULE}`,
        fontFamily: MONO,
      })}
    >
      <div style={flex({ fontSize: 24, color: MODEL })}>{`${model.name} · ${model.version}`}</div>
      <div style={flex({ justifyContent: 'space-between', alignItems: 'flex-end' })}>
        <div style={flex({ fontSize: 22, color: CAPTION })}>{model.computed ?? ''}</div>
        <div style={flex({ fontSize: 28, color: CAPTION })}>{host}</div>
      </div>
    </div>
  );
}

/** The three shares as one bar, the largest at full strength. */
function ShareBar({ shares, height }: { shares: SocialShare[]; height: number }): ReactElement {
  return (
    <div style={flex({ width: '100%', height, gap: 6 })}>
      {shares.map((share, i) => (
        <div
          key={share.outcome}
          style={flex({
            flexGrow: share.weight,
            flexBasis: 0,
            minWidth: 20,
            height,
            background: MODEL,
            opacity: RANK_OPACITY[share.rank],
            borderRadius: i === 0 ? '12px 0 0 12px' : i === shares.length - 1 ? '0 12px 12px 0' : 0,
          })}
        />
      ))}
    </div>
  );
}

const ALIGN = ['flex-start', 'center', 'flex-end'] as const;

/** The three numbers under the bar, home at the start, away at the end. */
function ShareNumbers({
  shares,
  size,
  marks,
}: {
  shares: SocialShare[];
  size: number;
  /** A line under a share: "Happened", "Model's pick". */
  marks?: Partial<Record<SocialShare['outcome'], ReactElement>>;
}): ReactElement {
  return (
    <div style={flex({ width: '100%' })}>
      {shares.map((share, i) => (
        <div
          key={share.outcome}
          style={flex({
            flexGrow: 1,
            flexBasis: 0,
            flexDirection: 'column',
            alignItems: ALIGN[i],
            gap: 6,
          })}
        >
          <div style={flex({ alignItems: 'flex-start', color: share.rank === 1 ? MODEL : MUTED })}>
            <div
              style={flex({ fontFamily: NARROW, fontWeight: 700, fontSize: size, lineHeight: 1 })}
            >
              {share.value}
            </div>
            <div
              style={flex({
                fontFamily: NARROW,
                fontWeight: 700,
                fontSize: Math.round(size * 0.42),
                marginTop: Math.round(size * 0.08),
              })}
            >
              %
            </div>
          </div>
          <div
            style={flex({
              fontFamily: MONO,
              fontSize: 26,
              color: CAPTION,
              textAlign:
                ALIGN[i] === 'center' ? 'center' : ALIGN[i] === 'flex-end' ? 'right' : 'left',
              maxWidth: 300,
            })}
          >
            {share.label.toLocaleUpperCase('en')}
          </div>
          {marks?.[share.outcome] ?? null}
        </div>
      ))}
    </div>
  );
}

function ForecastCard({ text, host }: { text: SocialForecastText; host: string }): ReactElement {
  return (
    <Page>
      <div style={flex({ flexDirection: 'column', gap: 40 })}>
        <Header chip={text.chip} model />
        <Eyebrow text={text.eyebrow} />
      </div>
      <div style={flex({ flexDirection: 'column', alignItems: 'center', gap: 36 })}>
        <div
          style={flex({ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' })}
        >
          <Team badge={text.home} size={200} width={400} />
          <div
            style={flex({
              height: 200,
              alignItems: 'center',
              fontSize: 40,
              fontWeight: 700,
              color: CAPTION,
            })}
          >
            v
          </div>
          <Team badge={text.away} size={200} width={400} />
        </div>
        <div style={flex({ fontSize: 44, fontWeight: 700 })}>{text.kickOff}</div>
      </div>
      <div style={flex({ flexDirection: 'column', gap: 28 })}>
        <ShareBar shares={text.shares} height={56} />
        <ShareNumbers shares={text.shares} size={128} />
      </div>
      <ModelFooter model={text.model} host={host} />
    </Page>
  );
}

/** A filled turquoise disc with a tick, or a ring with a cross: the verdict in a sign as well as words. */
function Stamp({ correct, size }: { correct: boolean; size: number }): ReactElement {
  return correct ? (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="50" fill={MODEL} />
      <path
        d="M27 52 L43 68 L74 35"
        fill="none"
        stroke={GROUND}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="45" fill="none" stroke={MUTED} strokeWidth="8" />
      <path
        d="M34 34 L66 66 M66 34 L34 66"
        fill="none"
        stroke={MUTED}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A small mark under a share: an upward triangle and its word. */
function Mark({ text, colour }: { text: string; colour: string }): ReactElement {
  return (
    <div
      style={flex({ alignItems: 'center', gap: 8, fontSize: 24, fontWeight: 700, color: colour })}
    >
      <svg width={18} height={16} viewBox="0 0 18 16">
        <path d="M9 0 L18 16 L0 16 Z" fill={colour} />
      </svg>
      {text}
    </div>
  );
}

function VerdictCard({ text, host }: { text: SocialVerdictText; host: string }): ReactElement {
  const marks: Partial<Record<SocialShare['outcome'], ReactElement>> = {
    [text.happened]: <Mark text="Happened" colour={INK} />,
  };
  if (text.called !== text.happened)
    marks[text.called] = <Mark text="Model's pick" colour={MODEL} />;
  return (
    <Page>
      <div style={flex({ flexDirection: 'column', gap: 36 })}>
        <Header chip={text.chip} model />
        <Eyebrow text={text.eyebrow} />
      </div>
      <div style={flex({ alignItems: 'center', gap: 32 })}>
        <Stamp correct={text.correct} size={120} />
        <div style={flex({ width: 784, fontSize: 80, fontWeight: 800, lineHeight: 1.05 })}>
          {text.verdict}
        </div>
      </div>
      <div
        style={flex({
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '28px 32px',
          borderRadius: 24,
          background: SURFACE,
        })}
      >
        <div style={flex({ width: 290, flexDirection: 'column', alignItems: 'center', gap: 14 })}>
          <Badge badge={text.home} size={112} />
          <div style={flex({ fontSize: 30, fontWeight: 700, textAlign: 'center' })}>
            {text.home.name}
          </div>
        </div>
        <div style={flex({ flexDirection: 'column', alignItems: 'center', gap: 8 })}>
          <div style={flex({ fontFamily: NARROW, fontWeight: 700, fontSize: 132, lineHeight: 1 })}>
            {text.score}
          </div>
          {text.scoreNote !== null && (
            <div style={flex({ fontFamily: MONO, fontSize: 24, color: SAFFRON })}>
              {text.scoreNote}
            </div>
          )}
        </div>
        <div style={flex({ width: 290, flexDirection: 'column', alignItems: 'center', gap: 14 })}>
          <Badge badge={text.away} size={112} />
          <div style={flex({ fontSize: 30, fontWeight: 700, textAlign: 'center' })}>
            {text.away.name}
          </div>
        </div>
      </div>
      <div style={flex({ flexDirection: 'column', gap: 20 })}>
        <div style={flex({ fontFamily: MONO, fontSize: 24, color: CAPTION, letterSpacing: 1 })}>
          FORECAST FROZEN BEFORE KICK-OFF
        </div>
        {text.shares !== null ? (
          <div style={flex({ flexDirection: 'column', gap: 20 })}>
            <ShareBar shares={text.shares} height={40} />
            <ShareNumbers shares={text.shares} size={96} marks={marks} />
          </div>
        ) : (
          <div style={flex({ alignItems: 'flex-end', gap: 20, color: MODEL })}>
            <div style={flex({ fontFamily: NARROW, fontWeight: 700, fontSize: 96, lineHeight: 1 })}>
              {`${text.pick.value}%`}
            </div>
            <div style={flex({ fontSize: 40, fontWeight: 700, paddingBottom: 8 })}>
              {text.pick.label}
            </div>
          </div>
        )}
        <div style={flex({ flexDirection: 'column', gap: 6, fontSize: 32, fontWeight: 700 })}>
          <div style={flex({ color: MODEL })}>{text.pickLine}</div>
          <div style={flex({})}>{text.outcomeLine}</div>
        </div>
        <div style={flex({ fontSize: 26, color: MUTED })}>
          One match says little: the model&apos;s full record is on the site.
        </div>
      </div>
      <ModelFooter model={text.model} host={host} />
    </Page>
  );
}

function Scorers({ scorers }: { scorers: NonNullable<SocialResultText['scorers']> }) {
  const rows = Math.max(scorers.home.length, scorers.away.length);
  const size = rows <= 3 ? 32 : rows <= 5 ? 28 : 24;
  const column = (list: SocialResultText['scorers'] & object, side: 'home' | 'away') => (
    <div
      style={flex({
        width: 420,
        flexDirection: 'column',
        alignItems: side === 'home' ? 'flex-start' : 'flex-end',
        gap: 10,
      })}
    >
      {list[side].map((goal, i) => (
        <div key={i} style={flex({ alignItems: 'baseline', gap: 14 })}>
          <div style={flex({ fontSize: size, fontWeight: 700 })}>{goal.player}</div>
          <div style={flex({ fontFamily: MONO, fontSize: size - 4, color: CAPTION })}>
            {goal.minute}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={flex({ width: '100%', justifyContent: 'space-between' })}>
      {column(scorers, 'home')}
      {column(scorers, 'away')}
    </div>
  );
}

function ResultCard({ text, host }: { text: SocialResultText; host: string }): ReactElement {
  return (
    <Page>
      <div style={flex({ flexDirection: 'column', gap: 36 })}>
        <Header chip={text.chip} model={false} />
        <Eyebrow text={text.eyebrow} />
      </div>
      <div style={flex({ flexDirection: 'column', alignItems: 'center', gap: 20 })}>
        <div
          style={flex({ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start' })}
        >
          <Team badge={text.home} size={200} width={400} />
          <Team badge={text.away} size={200} width={400} />
        </div>
        <div style={flex({ fontFamily: NARROW, fontWeight: 700, fontSize: 240, lineHeight: 1 })}>
          {text.score}
        </div>
        <div style={flex({ fontFamily: MONO, fontSize: 28, color: MUTED })}>{text.status}</div>
      </div>
      {text.scorers !== null && <Scorers scorers={text.scorers} />}
      <div
        style={flex({
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingTop: 28,
          borderTop: `2px solid ${RULE}`,
        })}
      >
        <div style={flex({ fontSize: 36, fontWeight: 700 })}>{text.date}</div>
        <div style={flex({ fontFamily: MONO, fontSize: 28, color: CAPTION })}>{host}</div>
      </div>
    </Page>
  );
}

/**
 * The card's ground: its parts spread from top to bottom. Each kind returns
 * one of these itself (the renderer lays a fragment's children out as a row).
 */
function Page({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={flex({
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: PAD,
        background: GROUND,
        color: INK,
        fontFamily: SANS,
      })}
    >
      {children}
    </div>
  );
}

/** One social card, 1080 x 1350, from its words. */
export function SocialCardImage({
  text,
  host,
}: {
  text: SocialCardText;
  host: string;
}): ReactElement {
  if (text.kind === 'forecast_pre_match') return <ForecastCard text={text} host={host} />;
  if (text.kind === 'model_verdict') return <VerdictCard text={text} host={host} />;
  return <ResultCard text={text} host={host} />;
}

/**
 * A post's card as a PNG answer, kept for good. A renderer failure is
 * answered 503 with no picture (`drawCard` would answer the plain card), as
 * is a payload the words cannot be made from: a post must never go out with
 * a picture other than its own.
 */
export async function drawSocialCard(payload: SocialCardPayload): Promise<Response> {
  let text: SocialCardText;
  try {
    text = socialCardText(payload);
  } catch {
    return noSocialCard(503);
  }
  const response = await drawCard(<SocialCardImage text={text} host={new URL(siteUrl()).host} />, {
    size: SOCIAL_CARD_SIZE,
    cacheControl: SOCIAL_CARD_CACHE,
  });
  if (response.headers.get('cache-control') === FAILED_CARD_CACHE) return noSocialCard(503);
  return response;
}

/** No picture: 404 for a post with no card, 503 for one that could not be drawn now. */
export function noSocialCard(status: 404 | 503): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
