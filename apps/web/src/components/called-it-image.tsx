import type { CSSProperties, ReactElement } from 'react';
import type { CalledItText } from '@/lib/share-card';
import {
  BLACK,
  CAPTION,
  Crest,
  Frame,
  INK,
  MONO,
  MUTED,
  NARROW,
  RULE,
  SAFFRON,
  Wordmark,
} from '@/components/share-card-image';

/**
 * The "called it" card (T-1723, D-351): B01 "The stamp" with B17's proof
 * line. A tilted saffron stamp, the score the pick was settled against, the
 * member's own pick and when they made it -- and nothing else: no rating, no
 * model, no other member (rule 6), none of a bookmaker's words. Drawn for a
 * correct, settled pick only (the API has no card for any other).
 *
 * `card` is 1200 x 630, for a chat preview; `story` is 1080 x 1920, for a
 * phone's story, with the content inside the middle 1420 px a story's own
 * header and reply bar leave alone.
 */

const flex = (style: CSSProperties = {}): CSSProperties => ({ display: 'flex', ...style });

function Team({
  name,
  crest,
  muted,
  crestSize,
  fontSize,
}: {
  name: string;
  crest: string | null;
  muted: boolean;
  crestSize: number;
  fontSize: number;
}): ReactElement {
  return (
    <div
      style={flex({
        flex: 1,
        flexBasis: 0,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      })}
    >
      <Crest src={crest} size={crestSize} name={name} />
      <div
        style={flex({
          textAlign: 'center',
          justifyContent: 'center',
          fontSize,
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

function Scoreline({
  text,
  crests,
  crestSize,
  scoreSize,
  nameSize,
}: {
  text: CalledItText;
  crests: { home: string | null; away: string | null };
  crestSize: number;
  scoreSize: number;
  nameSize: number;
}): ReactElement {
  return (
    <div style={flex({ alignItems: 'flex-start', gap: 20 })}>
      <Team
        name={text.home}
        crest={crests.home}
        muted={text.loser === 'home'}
        crestSize={crestSize}
        fontSize={nameSize}
      />
      <div
        style={flex({
          height: crestSize,
          alignItems: 'center',
          fontFamily: NARROW,
          fontWeight: 700,
          fontSize: scoreSize,
          lineHeight: 1,
        })}
      >
        {text.score}
      </div>
      <Team
        name={text.away}
        crest={crests.away}
        muted={text.loser === 'away'}
        crestSize={crestSize}
        fontSize={nameSize}
      />
    </div>
  );
}

function Stamp({ text, scale }: { text: CalledItText; scale: number }): ReactElement {
  return (
    <div
      style={flex({
        flexDirection: 'column',
        alignItems: 'center',
        gap: Math.round(8 * scale),
        border: `${Math.round(7 * scale)}px solid ${SAFFRON}`,
        borderRadius: Math.round(22 * scale),
        padding: `${Math.round(22 * scale)}px ${Math.round(34 * scale)}px`,
        color: SAFFRON,
        transform: 'rotate(-6deg)',
      })}
    >
      <div
        style={flex({
          fontFamily: BLACK,
          fontWeight: 900,
          fontSize: Math.round(62 * scale),
          letterSpacing: 1,
          lineHeight: 1,
        })}
      >
        CALLED IT
      </div>
      {text.exact !== null && (
        <div style={flex({ fontSize: Math.round(22 * scale), fontWeight: 800 })}>{text.exact}</div>
      )}
      <div
        style={flex({
          // A long name keeps the pick to two lines inside the stamp.
          fontSize: Math.round((text.pick.length > 26 ? 22 : 26) * scale),
          fontWeight: 700,
          textAlign: 'center',
          justifyContent: 'center',
        })}
      >
        {text.pick}
      </div>
    </div>
  );
}

function Eyebrow({ text, size }: { text: CalledItText; size: number }): ReactElement {
  return (
    <div
      style={flex({
        fontFamily: MONO,
        fontSize: size,
        color: CAPTION,
        textTransform: 'uppercase',
        letterSpacing: 1,
      })}
    >
      {text.eyebrow}
    </div>
  );
}

export function CalledItImage({
  text,
  host,
  crests = { home: null, away: null },
  variant = 'card',
}: {
  text: CalledItText;
  host: string;
  crests?: { home: string | null; away: string | null };
  variant?: 'card' | 'story';
}): ReactElement {
  if (variant === 'story') {
    return (
      <Frame padding="250px 72px" gap={0}>
        <Eyebrow text={text} size={28} />
        <div style={flex({ flexDirection: 'column', gap: 120 })}>
          <Scoreline text={text} crests={crests} crestSize={220} scoreSize={190} nameSize={44} />
          <div style={flex({ justifyContent: 'center' })}>
            <Stamp text={text} scale={1.45} />
          </div>
        </div>
        <div style={flex({ flexDirection: 'column', gap: 36 })}>
          <div style={flex({ fontFamily: MONO, fontSize: 25, color: MUTED, lineHeight: 1.4 })}>
            {text.proof}
          </div>
          <div
            style={flex({
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: `1px solid ${RULE}`,
              paddingTop: 32,
            })}
          >
            <div style={flex({ fontSize: 34, color: MUTED })}>{text.handle}</div>
            <Wordmark host={host} size={28} />
          </div>
        </div>
      </Frame>
    );
  }

  return (
    <Frame gap={18}>
      <Eyebrow text={text} size={20} />
      <div style={flex({ flex: 1, alignItems: 'center', gap: 36 })}>
        <div style={flex({ flex: 6, flexBasis: 0, flexDirection: 'column' })}>
          <Scoreline text={text} crests={crests} crestSize={128} scoreSize={128} nameSize={30} />
        </div>
        <div style={flex({ flex: 5, flexBasis: 0, justifyContent: 'center' })}>
          <Stamp text={text} scale={1} />
        </div>
      </div>
      <div style={flex({ fontFamily: MONO, fontSize: 19, color: MUTED })}>{text.proof}</div>
      <div
        style={flex({
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${RULE}`,
          paddingTop: 16,
        })}
      >
        <div style={flex({ fontSize: 26, color: MUTED })}>{text.handle}</div>
        <Wordmark host={host} size={18} />
      </div>
    </Frame>
  );
}
