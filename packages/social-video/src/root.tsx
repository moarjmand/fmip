import type { ReactElement } from 'react';
import { Composition } from 'remotion';
import fixture from '../fixtures/matchday-preview.json';
import { MatchdayPreview } from './compositions/matchday-preview.tsx';
import { loadFonts } from './fonts.ts';
import { parseClipProps } from './props.ts';
import { ASPECTS, CLIP, type Aspect } from './tokens.ts';

void loadFonts();

/** The fixture is the default; a render passes its own props over it. */
const defaultProps = parseClipProps(fixture);

/** One composition per aspect (D-454 point 10): 15 s at 30 frames a second. */
export function Root(): ReactElement {
  return (
    <>
      {(Object.keys(ASPECTS) as Aspect[]).map((aspect) => (
        <Composition
          key={aspect}
          id={`matchday-preview-${aspect}`}
          component={MatchdayPreview}
          width={ASPECTS[aspect].width}
          height={ASPECTS[aspect].height}
          fps={CLIP.fps}
          durationInFrames={CLIP.fps * CLIP.seconds}
          defaultProps={defaultProps}
        />
      ))}
    </>
  );
}
