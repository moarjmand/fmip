import {
  POWER_INDEX_LABELS,
  type PowerIndex,
  type PowerIndexComponent,
  type PowerIndexComponentValue,
} from '@fmip/contracts';

/**
 * Wording for the Power Index panel (T-114, blueprint 6.1).
 *
 * The blueprint asks the public display to explain "the leading factors, data
 * completeness and the time of calculation". The first two need words rather
 * than numbers to be honest, and those words are here so they can be tested.
 */

export { POWER_INDEX_LABELS };

/** The percentile as a sentence a reader can check, not a decimal. */
export function componentSentence(component: PowerIndexComponentValue): string {
  if (component.value === null) return 'Not available';
  const percent = Math.round(component.value * 100);
  if (percent >= 90) return `Top 10% of this competition`;
  if (percent <= 10) return `Bottom 10% of this competition`;
  return `Ahead of ${percent}% of this competition`;
}

/**
 * What the completeness figure means, said plainly.
 *
 * A percentage alone invites the reader to treat 70% as "mostly right" when
 * what it means is "three of the seven things this index is meant to weigh were
 * not measurable". The sentence says which, because that is the part that
 * changes how much weight to put on the number.
 */
export function completenessSentence(index: PowerIndex): string {
  const percent = Math.round(index.completeness * 100);
  const missing = index.components.filter((component) => component.value === null);
  if (missing.length === 0) return 'Every component was measured.';
  const names = missing.map((component) => POWER_INDEX_LABELS[component.key].toLowerCase());
  return `${percent}% of the index was measurable. Not included: ${listed(names)}.`;
}

/** The leading factors as a phrase, or an honest silence. */
export function leadingSentence(index: PowerIndex): string | null {
  if (index.leading.length === 0) return null;
  const names = index.leading.map((key: PowerIndexComponent) =>
    POWER_INDEX_LABELS[key].toLowerCase(),
  );
  return `Driven mostly by ${listed(names)}.`;
}

/** `a`, `a and b`, `a, b and c` — Oxford-free, which is what the rest of the UI uses. */
export function listed(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`;
}

/** Width of a component's bar, as a percentage string. Absent means no bar at all. */
export function barWidth(component: PowerIndexComponentValue): string | null {
  return component.value === null ? null : `${Math.round(component.value * 100)}%`;
}
