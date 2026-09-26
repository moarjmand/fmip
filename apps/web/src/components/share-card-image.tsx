import type { ReactElement } from 'react';
import { nameSize, type MatchCardText, type TableCardText } from '@/lib/share-card';

/**
 * The pictures behind the share cards (T-520), for `next/og`'s
 * `ImageResponse`. Its renderer understands inline styles and flexbox only,
 * so nothing here uses the app's classes; every box with more than one child
 * says `display: flex`. The words come from `lib/share-card.ts`.
 */

const INK = '#111827';
const MUTED = '#4b5563';
const PAPER = '#ffffff';
const RULE = '#e5e7eb';

function Frame({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 72px',
        background: PAPER,
        color: INK,
        fontFamily: 'sans-serif',
      }}
    >
      {children}
    </div>
  );
}

function Brand({ host }: { host: string }): ReactElement {
  return (
    <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: MUTED }}>
      {`FMIP · ${host}`}
    </div>
  );
}

/** Only the product's name: what a card says when its page could not be read. */
export function PlainCard(): ReactElement {
  return (
    <Frame>
      <div style={{ display: 'flex', fontSize: 72, fontWeight: 700 }}>FMIP</div>
      <div style={{ display: 'flex', fontSize: 34, color: MUTED }}>
        Live scores, match centres and forecasts
      </div>
    </Frame>
  );
}

export function MatchCardImage({
  text,
  host,
}: {
  text: MatchCardText;
  host: string;
}): ReactElement {
  return (
    <Frame>
      <div style={{ display: 'flex', fontSize: 30, color: MUTED }}>{text.eyebrow}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {/*
            Equal columns (a zero basis) keep the score in the middle however
            long either name is; a long name wraps within its own column,
            against the score, at a size chosen for its length.
          */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexBasis: 0,
              justifyContent: 'flex-end',
              textAlign: 'end',
              fontSize: nameSize(text.home),
              fontWeight: 700,
            }}
          >
            {text.home}
          </div>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 700 }}>{text.centre}</div>
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexBasis: 0,
              textAlign: 'start',
              fontSize: nameSize(text.away),
              fontWeight: 700,
            }}
          >
            {text.away}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', fontSize: 32, color: MUTED }}>
          {text.status}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {text.forecast === null ? (
          <div style={{ display: 'flex' }} />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              borderTop: `2px solid ${RULE}`,
              paddingTop: 18,
            }}
          >
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 600 }}>
              {text.forecast.line}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>
              {text.forecast.source}
            </div>
          </div>
        )}
        <Brand host={host} />
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
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 700 }}>{text.title}</div>
        <div style={{ display: 'flex', fontSize: 28, color: MUTED }}>{text.season}</div>
      </div>
      {text.absence !== null ? (
        <div style={{ display: 'flex', fontSize: 34, color: MUTED }}>{text.absence}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {text.rows.map((row) => (
            <div
              key={row.position}
              style={{ display: 'flex', fontSize: 32, gap: 24, borderBottom: `1px solid ${RULE}` }}
            >
              <div style={{ display: 'flex', width: 56 }}>{row.position}</div>
              <div style={{ display: 'flex', flex: 1 }}>{row.team}</div>
              <div style={{ display: 'flex', width: 110, color: MUTED }}>P {row.played}</div>
              <div style={{ display: 'flex', width: 120, fontWeight: 700 }}>{row.points} pts</div>
            </div>
          ))}
        </div>
      )}
      <Brand host={host} />
    </Frame>
  );
}
