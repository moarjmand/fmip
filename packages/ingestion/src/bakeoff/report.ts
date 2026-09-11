/**
 * The bake-off's results table, written into `docs/05-data-providers.md`
 * between two markers so a rerun replaces the previous table and touches
 * nothing else in the file (T-024's acceptance criterion).
 */

import type { BakeoffResult } from './run';

export const START_MARKER = '<!-- bakeoff:start -->';
export const END_MARKER = '<!-- bakeoff:end -->';
/** The placeholder the first run replaces. */
export const PLACEHOLDER = '> Results table — pending T-024.';

const pct = (value: number | null): string => (value === null ? '—' : `${value}%`);

export function renderMarkdown(result: BakeoffResult): string {
  const lines: string[] = [];
  lines.push(
    `### Results — ${result.mode} run, ${result.ranAt.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Fixture set: ${result.fixtureSet}. Written by \`scripts/bakeoff.mjs\`; do not edit by hand.`,
    '',
    '| Provider | Tier | Calls ok | Errors | Requests | Mean latency | Fixture fields | Lineup fields | Detail fields | Table fields |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const s of result.summaries) {
    const errors =
      Object.keys(s.errors).length === 0
        ? '0'
        : Object.entries(s.errors)
            .map(([kind, n]) => `${n} ${kind}`)
            .join(', ');
    lines.push(
      `| ${s.displayName} | ${s.tier} | ${s.ok}/${s.calls} | ${errors} | ${s.requests} | ${
        s.meanLatencyMs === null ? '—' : `${s.meanLatencyMs} ms`
      } | ${pct(s.completeness.fixture)} | ${pct(s.completeness.lineup)} | ${pct(s.completeness.detail)} | ${pct(s.completeness.standing)} |`,
    );
  }
  lines.push(
    '',
    'Field completeness is the share of optional normalised fields a provider filled, per module; "—" means the module never came back. Requests are what the adapters reported consuming, so quota efficiency is requests against calls ok.',
    '',
  );

  lines.push(
    `**Disagreements** (${result.disagreements.length}): same match, different facts.`,
    '',
  );
  if (result.disagreements.length === 0) {
    lines.push('None among the matched fixtures.', '');
  } else {
    lines.push('| Match | Field | Values |', '|---|---|---|');
    for (const d of result.disagreements) {
      const values = Object.entries(d.values)
        .map(([provider, value]) => `${provider}: ${value}`)
        .join('; ');
      lines.push(`| ${d.key} | ${d.field} | ${values} |`);
    }
    lines.push('');
  }

  lines.push('**Not measured by this run:**', '');
  for (const item of result.notMeasured) lines.push(`- ${item}`);
  lines.push('');

  lines.push(
    '<details><summary>Every call</summary>',
    '',
    '| Provider | Call | Label | Result | Requests | Items | Latency |',
    '|---|---|---|---|---|---|---|',
  );
  for (const c of result.calls) {
    lines.push(
      `| ${c.provider} | ${c.call} | ${c.label} | ${c.ok ? 'ok' : `error: ${c.errorKind ?? '?'}`} | ${c.requests} | ${c.items} | ${
        c.latencyMs === null ? '—' : `${c.latencyMs} ms`
      } |`,
    );
  }
  lines.push('', '</details>');
  return lines.join('\n');
}

/** Replaces the marked block (or the placeholder) in the document text. */
export function insertResults(document: string, markdown: string): string {
  const block = `${START_MARKER}\n${markdown}\n${END_MARKER}`;
  const start = document.indexOf(START_MARKER);
  const end = document.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    return `${document.slice(0, start)}${block}${document.slice(end + END_MARKER.length)}`;
  }
  if (document.includes(PLACEHOLDER)) return document.replace(PLACEHOLDER, block);
  throw new Error('neither the bake-off markers nor the placeholder are in the document');
}
