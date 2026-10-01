import type { PowerIndex, PowerIndexResponse } from '@fmip/contracts';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, message, t } from '@/i18n/messages';
import { formatKickoff } from '@/lib/scores';
import {
  barWidth,
  completenessSentence,
  componentLabel,
  componentSentence,
  leadingSentence,
  percentLabel,
} from '@/lib/power-index';
import { formatFixed } from '@/lib/words';
import { FilledMessage } from '@/components/filled-message';
import { Translated } from '@/components/translated';
import { Notice } from '@/components/ui';

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
 * worth ignoring. The words and digits are the reader's (T-1303).
 */
export function PowerIndexPanel({
  power,
  timeZone,
  locale,
}: {
  power: PowerIndexResponse | null;
  timeZone: string;
  locale: string;
}) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const title = (
    <h2 className="text-lg font-semibold">
      <Translated locale={locale} message="powerIndex.title" />
    </h2>
  );
  if (power === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="power-index" data-state="unreachable">
        {title}
        <Notice tone="danger">
          <Translated locale={locale} message="powerIndex.unreachable" />
        </Notice>
      </section>
    );
  }

  if (power.index === null) {
    return (
      <section className="flex flex-col gap-2" data-testid="power-index" data-state="unavailable">
        {title}
        <p className="text-sm text-muted" data-testid="power-index-none">
          {power.unavailable_reason ?? <Translated locale={locale} message="powerIndex.none" />}
        </p>
      </section>
    );
  }

  const { home, away } = power.index;
  const stamp = `${home.computed_at.slice(0, 10)} ${formatKickoff(locale, home.computed_at, timeZone)}`;

  return (
    <section className="flex flex-col gap-3" data-testid="power-index" data-state="available">
      {title}

      <div className="flex items-end justify-between gap-4" data-testid="power-index-values">
        {[home, away].map((side) => (
          <div key={side.team.id} className="flex flex-col">
            <span className="text-sm text-muted">{side.team.name}</span>
            <span className="text-3xl font-semibold tabular-nums">
              {formatFixed(l, side.value, 1)}
            </span>
          </div>
        ))}
      </div>

      {[home, away].map((side) => (
        <SideBreakdown key={side.team.id} side={side} locale={l} />
      ))}

      <p className="text-xs text-muted" data-testid="power-index-stamp">
        <FilledMessage
          message={message(l, 'powerIndex.stamp')}
          params={{ formula: home.formula_version, time: stamp }}
        />
      </p>
    </section>
  );
}

function SideBreakdown({ side, locale }: { side: PowerIndex; locale: Locale }) {
  const leading = leadingSentence(side, locale);
  return (
    <details className="rounded border border-default p-2 text-sm">
      <summary className="cursor-pointer">
        {interpolate(t(locale, 'powerIndex.sideSummary'), {
          team: side.team.name,
          value: formatFixed(locale, side.value, 1),
        })}
        <span className="ms-2 text-xs text-muted">
          {interpolate(t(locale, 'powerIndex.measured'), {
            percent: percentLabel(Math.round(side.completeness * 100), locale),
          })}
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
          const name = componentLabel(component.key, locale);
          return (
            <li key={component.key} className="flex flex-col gap-1">
              <div className="flex justify-between gap-2">
                <span>{name}</span>
                <span className="text-xs text-muted">
                  {interpolate(t(locale, 'powerIndex.weight'), {
                    percent: percentLabel(Math.round(component.weight * 100), locale),
                  })}
                </span>
              </div>
              {width === null ? (
                // No bar at all: a zero-width one reads as "measured, and bad".
                <span className="text-xs text-muted" data-testid="power-index-absent">
                  {interpolate(t(locale, 'powerIndex.absent'), {
                    note: component.note ?? t(locale, 'powerIndex.noSource'),
                  })}
                </span>
              ) : (
                <>
                  <div
                    className="h-1.5 w-full rounded bg-surface-raised"
                    role="img"
                    aria-label={`${name}: ${componentSentence(component, locale)}`}
                  >
                    <div className="h-1.5 rounded bg-accent" style={{ inlineSize: width }} />
                  </div>
                  <span className="text-xs text-muted">
                    {componentSentence(component, locale)}
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

      <p className="mt-2 text-xs text-muted" data-testid="power-index-completeness">
        {completenessSentence(side, locale)}
      </p>
    </details>
  );
}
