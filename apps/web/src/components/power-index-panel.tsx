import type { PowerIndex, PowerIndexResponse } from '@fmip/contracts';
import { formatKickoff } from '@/lib/scores';
import {
  POWER_INDEX_LABELS,
  barWidth,
  completenessSentence,
  componentSentence,
  leadingSentence,
} from '@/lib/power-index';

/**
 * The Power Index on the match centre (T-114, blueprint 6.1).
 *
 * The blueprint asks the public display to explain the leading factors, the
 * data completeness and the time of calculation, and all three are here for the
 * same reason: the number on its own is an assertion, and the panel's job is to
 * make it a claim a reader can check.
 *
 * A component nothing measured shows as "Not available" with the reason, not as
 * an empty row or a zero-width bar (rule 3) — an empty bar reads as "measured,
 * and it is bad", which is the opposite of the truth. Completeness is never
 * hidden: it is the difference between a number worth arguing with and one
 * worth ignoring.
 */
export function PowerIndexPanel({
  power,
  timeZone,
}: {
  power: PowerIndexResponse | null;
  timeZone: string;
}) {
  if (power === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="power-index" data-state="unreachable">
        <h2 className="text-lg font-semibold">Power Index</h2>
        <p role="alert" className="text-sm">
          The Power Index service could not be reached, so no index can be shown.
        </p>
      </section>
    );
  }

  if (power.index === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="power-index" data-state="unavailable">
        <h2 className="text-lg font-semibold">Power Index</h2>
        <p className="text-sm opacity-70" data-testid="power-index-none">
          {power.unavailable_reason ?? 'No Power Index is available for this match.'}
        </p>
      </section>
    );
  }

  const { home, away } = power.index;
  const stamp = `${home.computed_at.slice(0, 10)} ${formatKickoff(home.computed_at, timeZone)}`;

  return (
    <section className="flex flex-col gap-3" data-testid="power-index" data-state="available">
      <h2 className="text-lg font-semibold">Power Index</h2>

      <div className="flex items-end justify-between gap-4" data-testid="power-index-values">
        {[home, away].map((side) => (
          <div key={side.team.id} className="flex flex-col">
            <span className="text-sm opacity-70">{side.team.name}</span>
            <span className="text-3xl font-semibold tabular-nums">{side.value.toFixed(1)}</span>
          </div>
        ))}
      </div>

      {[home, away].map((side) => (
        <SideBreakdown key={side.team.id} side={side} />
      ))}

      <p className="text-xs opacity-60" data-testid="power-index-stamp">
        Formula {home.formula_version}, computed {stamp}. 0–100 is this team&rsquo;s standing in its
        competition, not a probability.
      </p>
    </section>
  );
}

function SideBreakdown({ side }: { side: PowerIndex }) {
  const leading = leadingSentence(side);
  return (
    <details className="rounded border border-current/15 p-2 text-sm">
      <summary className="cursor-pointer">
        {side.team.name} — {side.value.toFixed(1)}
        <span className="ms-2 text-xs opacity-60">
          {Math.round(side.completeness * 100)}% measured
        </span>
      </summary>

      {leading !== null ? (
        <p className="mt-2" data-testid="power-index-leading">
          {leading}
        </p>
      ) : null}

      <ul className="mt-2 flex flex-col gap-2">
        {side.components.map((component) => {
          const width = barWidth(component);
          return (
            <li key={component.key} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <span>{POWER_INDEX_LABELS[component.key]}</span>
                <span className="text-xs opacity-70">
                  {Math.round(component.weight * 100)}% of the index
                </span>
              </div>
              {width === null ? (
                // No bar at all: a zero-width one reads as "measured, and bad".
                <span className="text-xs opacity-70" data-testid="power-index-absent">
                  Not available — {component.note ?? 'no source supplied it'}
                </span>
              ) : (
                <>
                  <div
                    className="h-1.5 w-full rounded bg-current/10"
                    role="img"
                    aria-label={`${POWER_INDEX_LABELS[component.key]}: ${componentSentence(component)}`}
                  >
                    <div className="h-1.5 rounded bg-current/60" style={{ inlineSize: width }} />
                  </div>
                  <span className="text-xs opacity-70">
                    {componentSentence(component)}
                    {component.state === 'limited' && component.note !== null
                      ? ` — ${component.note}`
                      : ''}
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-xs opacity-70" data-testid="power-index-completeness">
        {completenessSentence(side)}
      </p>
    </details>
  );
}
