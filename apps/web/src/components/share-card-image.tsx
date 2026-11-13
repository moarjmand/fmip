import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { NIGHT_COLOURS } from '@/lib/brand-colours';
import { CARD_FACES } from '@/lib/card-fonts';
import {
  BRAND_CARD,
  nameSize,
  type MatchCardText,
  type MemberCardText,
  type TableCardText,
  type TeamCardText,
  teamNameSize,
} from '@/lib/share-card';

/**
 * The pictures behind the share cards (T-520), for `next/og`'s
 * `ImageResponse`. Its renderer understands inline styles and flexbox only,
 * so nothing here uses the app's classes; every box with more than one child
 * says `display: flex`, and no grid, `font-stretch` or logical property is
 * used (none of them is drawn). The words come from `lib/share-card.ts`.
 *
 * Drawn on Night (T-1723, D-351, turning T-602's light card dark, as every
 * card on the Design System's canvas is): the colours are the dark tokens'
 * values from `lib/brand-colours.ts`, since the renderer cannot read a CSS
 * variable, and the faces are the bundled TrueType files (`lib/card-fonts.ts`).
 * Turquoise is the model's colour and nothing else's (rule 6).
 */

export const INK = NIGHT_COLOURS.text;
export const MUTED = NIGHT_COLOURS['text-muted'];
export const CAPTION = NIGHT_COLOURS.caption;
export const GROUND = NIGHT_COLOURS.canvas;
export const RULE = NIGHT_COLOURS.border;
export const SAFFRON = NIGHT_COLOURS.accent;
export const MODEL = NIGHT_COLOURS.model;

export const SANS = `${CARD_FACES.sans}, sans-serif`;
export const NARROW = `${CARD_FACES.narrow}, ${CARD_FACES.sans}, sans-serif`;
export const BLACK = `${CARD_FACES.black}, ${CARD_FACES.sans}, sans-serif`;
export const MONO = `${CARD_FACES.mono}, monospace`;

const flex = (style: CSSProperties = {}): CSSProperties => ({ display: 'flex', ...style });

export function Frame({
  children,
  padding = '48px 64px',
  gap = 24,
}: {
  children: ReactNode;
  padding?: string;
  gap?: number;
}): ReactElement {
  return (
    <div
      style={flex({
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap,
        padding,
        background: GROUND,
        color: INK,
        fontFamily: SANS,
      })}
    >
      {children}
    </div>
  );
}

/**
 * A crest on the white tile every logo stands on (D-280), or an empty ring of
 * the same size when there is none to draw (rule 3: nothing made up).
 */
export function Crest({
  src,
  size,
  ring = RULE,
}: {
  src: string | null;
  size: number;
  /** The empty ring's colour: the rule on Night, the band's text on a club's band. */
  ring?: string;
}): ReactElement {
  if (src === null) {
    return (
      <div
        style={flex({
          width: size,
          height: size,
          borderRadius: size,
          border: `3px solid ${ring}`,
        })}
      />
    );
  }
  const inner = Math.round(size * 0.7);
  return (
    <div
      style={flex({
        width: size,
        height: size,
        borderRadius: size,
        background: NIGHT_COLOURS['logo-tile'],
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page */}
      <img src={src} width={inner} height={inner} alt="" style={{ objectFit: 'contain' }} />
    </div>
  );
}

/** The mark, the name in capitals, and the address the card links to. */
export function Wordmark({
  host,
  size = 20,
}: {
  host: string | null;
  size?: number;
}): ReactElement {
  return (
    <div style={flex({ alignItems: 'center', gap: Math.round(size * 0.6) })}>
      <BrandMark size={Math.round(size * 2)} ground="night" />
      <div style={flex({ flexDirection: 'column', gap: 4 })}>
        <div style={flex({ fontFamily: BLACK, fontWeight: 900, fontSize: size, letterSpacing: 1 })}>
          STADIOMIND
        </div>
        {host !== null && (
          <div
            style={flex({ fontFamily: MONO, fontSize: Math.round(size * 0.75), color: CAPTION })}
          >
            {host}
          </div>
        )}
      </div>
    </div>
  );
}

/** Only the product: what a card says when its page could not be read. */
export function PlainCard(): ReactElement {
  return (
    <Frame padding="56px 72px">
      <div style={flex({ alignItems: 'center', gap: 28 })}>
        <BrandMark size={96} ground="night" />
        <div style={flex({ fontFamily: BLACK, fontWeight: 900, fontSize: 72, letterSpacing: 2 })}>
          STADIOMIND
        </div>
      </div>
      <div style={flex({ fontSize: 34, color: MUTED })}>
        Live scores, match centres and forecasts
      </div>
    </Frame>
  );
}

/**
 * The brand card (T-1825, D-419; B10 "Typographic wall"): the card of every
 * page with no card of its own. Only type: the brand line at 108px over
 * three lines with "record" lit in saffron, the mark and name above it, the
 * strap and the address under it. Static, so it never goes stale. The
 * renderer does not flow text across differently styled spans, so the line
 * is one word per box in a wrapping row, a word space apart.
 */
export function BrandCardImage({ host }: { host: string }): ReactElement {
  const words = [
    ...BRAND_CARD.before.split(' ').map((word) => ({ word, lit: false })),
    { word: BRAND_CARD.lit, lit: true },
    ...BRAND_CARD.after.split(' ').map((word) => ({ word, lit: false })),
  ];
  return (
    <Frame padding="52px 64px 44px" gap={0}>
      <Wordmark host={null} size={28} />
      <div
        style={flex({
          flexWrap: 'wrap',
          columnGap: 27,
          width: 1072,
          fontSize: 108,
          fontWeight: 800,
          lineHeight: 1.01,
          letterSpacing: -2.5,
        })}
      >
        {words.map(({ word, lit }, index) => (
          <div key={index} style={flex({ color: lit ? SAFFRON : INK })}>
            {word}
          </div>
        ))}
      </div>
      <div style={flex({ alignItems: 'baseline', justifyContent: 'space-between', gap: 32 })}>
        <div style={flex({ fontFamily: MONO, fontSize: 28, color: MUTED, letterSpacing: 0.5 })}>
          {BRAND_CARD.strap}
        </div>
        <div style={flex({ fontFamily: MONO, fontSize: 26, color: CAPTION })}>{host}</div>
      </div>
    </Frame>
  );
}

function TeamColumn({
  name,
  crest,
  muted,
}: {
  name: string;
  crest: string | null;
  muted: boolean;
}): ReactElement {
  return (
    <div
      style={flex({
        flex: 1,
        flexBasis: 0,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
      })}
    >
      <Crest src={crest} size={176} />
      <div
        style={flex({
          textAlign: 'center',
          justifyContent: 'center',
          fontSize: nameSize(name),
          fontWeight: muted ? 700 : 800,
          lineHeight: 1.1,
          color: muted ? MUTED : INK,
        })}
      >
        {name}
      </div>
    </div>
  );
}

/**
 * The match card: A10 "Matchday poster" (T-1723). The two crests and names in
 * equal columns (a zero basis keeps the score in the middle however long
 * either name is), the score or "v" between, the state under it, and the
 * model's line in its own colour at the foot -- or no model line at all for a
 * match not played as scheduled.
 */
export function MatchCardImage({
  text,
  host,
  crests = { home: null, away: null },
}: {
  text: MatchCardText;
  host: string;
  crests?: { home: string | null; away: string | null };
}): ReactElement {
  const before = text.centre === 'v';
  return (
    <Frame>
      <div
        style={flex({
          fontFamily: MONO,
          fontSize: 22,
          color: SAFFRON,
          textTransform: 'uppercase',
          letterSpacing: 1,
        })}
      >
        {text.eyebrow}
      </div>
      <div style={flex({ flex: 1, flexDirection: 'column', justifyContent: 'center', gap: 14 })}>
        <div style={flex({ alignItems: 'flex-start', gap: 32 })}>
          <TeamColumn name={text.home} crest={crests.home} muted={text.loser === 'home'} />
          <div
            style={flex({
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: 176,
              gap: 4,
            })}
          >
            <div
              style={flex({
                fontFamily: NARROW,
                fontWeight: 700,
                fontSize: before ? 80 : 132,
                lineHeight: 1,
                color: before ? CAPTION : text.disputed ? MUTED : INK,
              })}
            >
              {text.centre}
            </div>
            {text.decided !== null && (
              <div style={flex({ fontFamily: MONO, fontSize: 22, color: MUTED })}>
                {text.decided}
              </div>
            )}
          </div>
          <TeamColumn name={text.away} crest={crests.away} muted={text.loser === 'away'} />
        </div>
        <div
          style={flex({ justifyContent: 'center', fontSize: 26, fontWeight: 700, color: MUTED })}
        >
          {text.status}
        </div>
      </div>
      <div
        style={flex({
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 32,
          borderTop: `1px solid ${RULE}`,
          paddingTop: 18,
        })}
      >
        {text.model === null ? (
          <div style={flex({ flex: 1 })} />
        ) : (
          <div style={flex({ flex: 1, flexDirection: 'column', gap: 6 })}>
            <div style={flex({ fontFamily: MONO, fontSize: 19, color: MODEL, lineHeight: 1.3 })}>
              {text.model.line}
            </div>
            {text.model.source !== null && (
              <div style={flex({ fontFamily: MONO, fontSize: 15, color: CAPTION })}>
                {`The statistical model · ${text.model.source}`}
              </div>
            )}
          </div>
        )}
        <Wordmark host={host} />
      </div>
    </Frame>
  );
}

export function TableCardImage({
  text,
  host,
}: {
  text: TableCardText;
  host: string;
}): ReactElement {
  return (
    <Frame padding="56px 72px">
      <div style={flex({ flexDirection: 'column', gap: 6 })}>
        <div style={flex({ fontSize: 52, fontWeight: 800 })}>{text.title}</div>
        <div style={flex({ fontFamily: MONO, fontSize: 24, color: CAPTION })}>{text.season}</div>
      </div>
      {text.absence !== null ? (
        <div style={flex({ fontSize: 34, color: MUTED })}>{text.absence}</div>
      ) : (
        <div style={flex({ flexDirection: 'column', gap: 8 })}>
          {text.rows.map((row) => (
            <div
              key={row.position}
              style={flex({ fontSize: 32, gap: 24, borderBottom: `1px solid ${RULE}` })}
            >
              <div style={flex({ width: 56, color: MUTED })}>{row.position}</div>
              <div style={flex({ flex: 1, fontWeight: 700 })}>{row.team}</div>
              <div style={flex({ width: 110, color: MUTED })}>P {row.played}</div>
              <div style={flex({ width: 120, fontWeight: 800 })}>{row.points} pts</div>
            </div>
          ))}
        </div>
      )}
      <Wordmark host={host} />
    </Frame>
  );
}

export function MemberCardImage({
  text,
  host,
}: {
  text: MemberCardText;
  host: string;
}): ReactElement {
  return (
    <Frame padding="56px 72px">
      <div style={flex({ flexDirection: 'column', gap: 6 })}>
        <div style={flex({ fontSize: 56, fontWeight: 800 })}>{text.name}</div>
        <div style={flex({ fontFamily: MONO, fontSize: 26, color: CAPTION })}>{text.handle}</div>
        <div style={flex({ fontSize: 34, marginTop: 12 })}>{text.rating}</div>
      </div>
      <div style={flex({ flexDirection: 'column', gap: 10 })}>
        {text.recent.map((line) => (
          <div
            key={line.match}
            style={flex({ fontSize: 30, gap: 24, borderBottom: `1px solid ${RULE}` })}
          >
            <div style={flex({ flex: 1 })}>{line.match}</div>
            <div style={flex({ color: MUTED })}>{line.verdict}</div>
          </div>
        ))}
      </div>
      <Wordmark host={host} />
    </Frame>
  );
}

/**
 * The team card (T-1826, D-420; T1 "Club band"): the club page's band as a
 * card. The top 232px are the club's colour (`paint`, from `bandColours`, or
 * the neutral slate when the club has none or one that looks like a
 * placeholder), with the crest on its white tile -- or an empty ring --, the
 * eyebrow and the name; under it the main competition and the standing,
 * the next match in its own panel, the date the card was drawn and the mark.
 * An absent competition or match is said in the muted colour, never hidden
 * or invented (rule 3). Laid out absolutely, as the board draws it: the
 * renderer draws left to right only, and the words are English (D-419).
 */
export function TeamCardImage({
  text,
  host,
  crest,
  paint,
}: {
  text: TeamCardText;
  host: string;
  crest: string | null;
  paint: { fill: string; text: string };
}): ReactElement {
  const size = teamNameSize(text.name);
  return (
    <div
      style={flex({
        position: 'relative',
        width: '100%',
        height: '100%',
        background: GROUND,
        color: INK,
        fontFamily: SANS,
      })}
    >
      <div
        style={flex({
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1200,
          height: 232,
          background: paint.fill,
        })}
      />
      <div style={flex({ position: 'absolute', left: 64, top: 40 })}>
        <Crest src={crest} size={152} ring={paint.text} />
      </div>
      <div
        style={flex({
          position: 'absolute',
          left: 250,
          top: 34,
          width: 886,
          height: 172,
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 14,
          color: paint.text,
        })}
      >
        {text.eyebrow !== '' && (
          <div
            style={flex({
              fontFamily: MONO,
              fontSize: 24,
              textTransform: 'uppercase',
              letterSpacing: 1,
            })}
          >
            {text.eyebrow}
          </div>
        )}
        <div
          style={flex({ fontSize: size, fontWeight: 800, lineHeight: 1.02, letterSpacing: -0.5 })}
        >
          {text.name}
        </div>
      </div>
      <div
        style={flex({
          position: 'absolute',
          left: 64,
          top: 260,
          width: 1072,
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 32,
        })}
      >
        <div
          style={flex({
            fontSize: text.competition.known ? 38 : 34,
            fontWeight: text.competition.known ? 800 : 700,
            color: text.competition.known ? INK : MUTED,
          })}
        >
          {text.competition.name}
        </div>
        {text.standing !== null && (
          <div style={flex({ fontSize: 34, fontWeight: 700, color: MUTED })}>{text.standing}</div>
        )}
      </div>
      <div
        style={flex({
          position: 'absolute',
          left: 64,
          top: 340,
          width: 1072,
          flexDirection: 'column',
          gap: 10,
          padding: '24px 36px 26px',
          borderRadius: 18,
          background: NIGHT_COLOURS.surface,
        })}
      >
        <div
          style={flex({
            fontFamily: MONO,
            fontSize: 24,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: text.next.known ? SAFFRON : MUTED,
          })}
        >
          Next match
        </div>
        <div
          style={flex({
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1.1,
            color: text.next.known ? INK : MUTED,
          })}
        >
          {text.next.match}
        </div>
        {text.next.detail !== null && (
          <div style={flex({ fontSize: 32, color: MUTED })}>{text.next.detail}</div>
        )}
      </div>
      <div
        style={flex({
          position: 'absolute',
          left: 64,
          bottom: 48,
          fontFamily: MONO,
          fontSize: 22,
          color: CAPTION,
        })}
      >
        {text.asOf}
      </div>
      <div style={flex({ position: 'absolute', right: 64, bottom: 40 })}>
        <Wordmark host={host} size={22} />
      </div>
    </div>
  );
}
