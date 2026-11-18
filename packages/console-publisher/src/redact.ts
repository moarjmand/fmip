import type { ConsoleSeverity, ConsoleSnapshot } from '@fmip/contracts';

/**
 * What of the security work leaves this computer (T-1879, D-340): the pure
 * part. The console is on the public site's server and two people read it;
 * the detail of a weakness that is not closed stays here, with the maintainer
 * in his own session. `withholdSecurity` is applied to every snapshot by
 * `snapshotOf`, and `redactSecurityText` to every chat reply before upload.
 *
 * THE RULE
 *
 * 1. A security finding is one written by the `security` agent or whose id is
 *    `sec-YYYY-MM-DD-NN`. Its detail is RELEASABLE only when its latest line
 *    in the findings files has `"status": "resolved"` (a fix someone
 *    re-checked) or `"public": true`. Everything else is WITHHELD: `new`,
 *    `open`, `decide`, `fixed-unverified`, `accepted`, any other word, and an
 *    id the findings files do not have at all.
 * 2. A withheld finding keeps its id, severity, status, title and first day;
 *    its `detail` and `related` are `null`.
 * 3. Text (the brief, every report, every memory entry, a desk question's
 *    context, a chat reply) is redacted where it names a withheld id:
 *    a. a heading that names one: the heading and its whole section (to the
 *       next heading of the same or a higher level) become one line;
 *    b. otherwise the BLOCK that names one becomes one line. A block is a
 *       list item with everything indented under it, one table row, or a
 *       paragraph (the lines up to a blank line, a heading, a list item or a
 *       table row);
 *    c. a redacted paragraph that ends with a colon takes the list items that
 *       follow it too (it introduced them).
 *    The one line is the id, `security`, the severity and title the findings
 *    files have for it, and a note that the detail is not shown.
 * 4. The `security` agent's own reports go out with no text, and of its
 *    memory (`.claude/agent-memory/security/`) nothing: one entry says so.
 *
 * What the rule does not catch: detail written in a block that does not name
 * the id (a later paragraph, a report section under a heading without the
 * id). The agents' instructions keep such detail out of the brief, other
 * agents' reports and chat; this is the net under them, not the only guard.
 */

export const SECURITY_AGENT = 'security';

// The charter's id for a security finding; a Persian brief may write the digits in Persian.
const D = '[0-9\\u06F0-\\u06F9\\u0660-\\u0669]';
const SEC_ID_SOURCE = `sec-${D}{4}-${D}{2}-${D}{2}-${D}{1,4}`;
const SEC_ID_EXACT = new RegExp(`^${SEC_ID_SOURCE}$`, 'i');
const SEC_ID_IN_TEXT = new RegExp(`(?<![A-Za-z0-9])${SEC_ID_SOURCE}(?!${D})`, 'gi');

/** An id in ASCII digits and lower case, as the findings files write it. */
export const normalId = (id: string): string =>
  id
    .toLowerCase()
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

export const isSecurityFinding = (id: string, agent: string): boolean =>
  agent === SECURITY_AGENT || SEC_ID_EXACT.test(id);

export interface SecurityFact {
  severity: ConsoleSeverity | null;
  title: string;
  /** Whether its detail may leave the computer (rule 1). */
  releasable: boolean;
}

/** Every security finding the findings files have, by normal id; the latest line of each wins. */
export type SecurityLedger = ReadonlyMap<string, SecurityFact>;

const SEVERITIES: readonly ConsoleSeverity[] = ['critical', 'major', 'minor', 'info'];
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The ledger from the findings files' lines, in file and line order. */
export function securityLedger(
  lines: readonly { record: Record<string, unknown> }[],
): SecurityLedger {
  const ledger = new Map<string, SecurityFact>();
  for (const { record } of lines) {
    const id = str(record.id);
    if (id === '' || !isSecurityFinding(id, str(record.agent))) continue;
    ledger.set(normalId(id), {
      severity: SEVERITIES.find((s) => s === record.severity) ?? null,
      title: str(record.title),
      releasable: record.status === 'resolved' || record.public === true,
    });
  }
  return ledger;
}

/** Whether a finding's detail stays on the computer (rule 1). */
export const withholds = (ledger: SecurityLedger, id: string, agent: string): boolean =>
  isSecurityFinding(id, agent) && ledger.get(normalId(id))?.releasable !== true;

/** The withheld ids a piece of text names, each once, in order. */
export function withheldIdsIn(text: string, ledger: SecurityLedger): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(SEC_ID_IN_TEXT)) {
    const id = normalId(match[0]);
    if (ledger.get(id)?.releasable !== true) found.add(id);
  }
  // A security finding whose id is not the charter's shape is matched as written.
  const lower = text.toLowerCase();
  for (const [id, fact] of ledger) {
    if (!fact.releasable && !SEC_ID_EXACT.test(id) && lower.includes(id)) found.add(id);
  }
  return [...found];
}

/** Persian: the console shows the text as written (D-352). */
export const WITHHELD_NOTE = 'جزئیات این یافته‌ی امنیتی در کنسول نمایش داده نمی‌شود (D-340).';

/** What the console shows in place of the security agent's memory. Persian, as above. */
export const MEMORY_NOTE = 'حافظه‌ی عامل امنیت در کنسول نمایش داده نمی‌شود (D-340).';

/** The one line a redacted block becomes: what the console may show of each finding, and the note. */
export function withheldLine(ids: readonly string[], ledger: SecurityLedger): string {
  const named = ids.map((id) => {
    const fact = ledger.get(id);
    const label = `[${[id, 'security', fact?.severity].filter(Boolean).join(' · ')}]`;
    return fact === undefined || fact.title === '' ? label : `${label} ${fact.title}`;
  });
  return `${named.join(' ؛ ')} — ${WITHHELD_NOTE}`;
}

const HEADING = /^ {0,3}(#{1,6})(?:\s|$)/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const blank = (line: string): boolean => line.trim() === '';
const indentOf = (line: string): number => /^\s*/.exec(line)![0].replace(/\t/g, '    ').length;
const endsWithColon = (line: string): boolean => /[:：]\s*(?:\*\*|__|\*|_)?\s*$/.test(line);

type BlockKind = 'heading' | 'blank' | 'row' | 'item' | 'paragraph';
interface Block {
  kind: BlockKind;
  lines: string[];
}

/** The text's lines as blocks (rule 3b). */
function blocksOf(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i]!;
    if (HEADING.test(first)) {
      blocks.push({ kind: 'heading', lines: [first] });
      i += 1;
      continue;
    }
    if (blank(first)) {
      blocks.push({ kind: 'blank', lines: [first] });
      i += 1;
      continue;
    }
    if (TABLE_ROW.test(first)) {
      blocks.push({ kind: 'row', lines: [first] });
      i += 1;
      continue;
    }
    const kind: BlockKind = LIST_ITEM.test(first) ? 'item' : 'paragraph';
    const indent = indentOf(first);
    let end = i + 1;
    while (end < lines.length) {
      const next = lines[end]!;
      if (HEADING.test(next) || TABLE_ROW.test(next)) break;
      if (blank(next)) {
        // What is indented deeper after the gap still belongs to the block.
        let after = end;
        while (after < lines.length && blank(lines[after]!)) after += 1;
        const resumes =
          after < lines.length &&
          !HEADING.test(lines[after]!) &&
          !TABLE_ROW.test(lines[after]!) &&
          indentOf(lines[after]!) > indent;
        if (!resumes) break;
        end = after + 1;
        continue;
      }
      if (LIST_ITEM.test(next) && (kind === 'paragraph' || indentOf(next) <= indent)) break;
      end += 1;
    }
    blocks.push({ kind, lines: lines.slice(i, end) });
    i = end;
  }
  return blocks;
}

/**
 * Text with every part that names a withheld security finding replaced by
 * one line (rule 3). Text that names none comes back unchanged.
 */
export function redactSecurityText(text: string, ledger: SecurityLedger): string {
  if (withheldIdsIn(text, ledger).length === 0) return text;
  const blocks = blocksOf(text.split(/\r?\n/));
  const out: string[] = [];
  let b = 0;
  while (b < blocks.length) {
    const block = blocks[b]!;
    const first = block.lines[0]!;
    const ids = withheldIdsIn(block.lines.join('\n'), ledger);
    if (ids.length === 0) {
      out.push(...block.lines);
      b += 1;
      continue;
    }
    const line = withheldLine(ids, ledger);
    if (block.kind === 'heading') {
      // Rule 3a: the section goes with its heading.
      const marks = HEADING.exec(first)![1]!;
      out.push(`${marks} ${line}`, '');
      b += 1;
      while (b < blocks.length) {
        const next = blocks[b]!;
        if (next.kind === 'heading' && HEADING.exec(next.lines[0]!)![1]!.length <= marks.length)
          break;
        b += 1;
      }
      continue;
    }
    if (block.kind === 'row') out.push(`| ${line} |`);
    else if (block.kind === 'item') out.push(`${LIST_ITEM.exec(first)![0]}${line}`);
    else out.push(line);
    b += 1;
    // Rule 3c: a paragraph that introduced a list takes the list.
    if (block.kind === 'paragraph' && endsWithColon(block.lines.at(-1)!)) {
      let ahead = b;
      while (ahead < blocks.length && blocks[ahead]!.kind === 'blank') ahead += 1;
      if (ahead < blocks.length && blocks[ahead]!.kind === 'item') {
        while (
          ahead < blocks.length &&
          (blocks[ahead]!.kind === 'item' ||
            (blocks[ahead]!.kind === 'blank' && blocks[ahead + 1]?.kind === 'item'))
        )
          ahead += 1;
        b = ahead;
      }
    }
  }
  return out.join('\n');
}

/**
 * The snapshot as it may leave the computer (rules 2 to 4). `snapshotOf`
 * applies it to every snapshot, so no caller can publish around it.
 */
export function withholdSecurity(
  parts: Omit<ConsoleSnapshot, 'schema'>,
  ledger: SecurityLedger,
): Omit<ConsoleSnapshot, 'schema'> {
  const clean = (text: string): string => redactSecurityText(text, ledger);
  return {
    ...parts,
    agents: parts.agents.map((agent) => ({
      ...agent,
      memory: {
        sources: agent.memory.sources,
        entries:
          agent.name === SECURITY_AGENT
            ? agent.memory.sources.some((source) => source.kind === 'memory')
              ? // Said, not left looking empty (rule 3 of the project: never fake coverage).
                [
                  {
                    path: `.claude/agent-memory/${SECURITY_AGENT}/`,
                    updated_at: parts.generated_at,
                    text: MEMORY_NOTE,
                  },
                ]
              : []
            : agent.memory.entries.map((entry) => ({ ...entry, text: clean(entry.text) })),
      },
    })),
    findings: parts.findings.map((finding) =>
      withholds(ledger, finding.id, finding.agent)
        ? { ...finding, detail: null, related: null }
        : {
            ...finding,
            detail: finding.detail === null ? null : clean(finding.detail),
            related: finding.related === null ? null : clean(finding.related),
          },
    ),
    reports: parts.reports.map((report) =>
      report.agent === SECURITY_AGENT
        ? { ...report, title: clean(report.title), text: '' }
        : { ...report, title: clean(report.title), text: clean(report.text) },
    ),
    brief:
      parts.brief === null || parts.brief === undefined
        ? null
        : { ...parts.brief, text: clean(parts.brief.text) },
    decisions: parts.decisions.map((decision) => ({
      ...decision,
      summary: clean(decision.summary),
    })),
  };
}
