import type { ConsoleSeverity, ConsoleSnapshot } from '@fmip/contracts';

/**
 * What of the security work leaves this computer (T-1879, D-340): the pure
 * part. The console is on the public site's server and two people read it;
 * the detail of a weakness that is not closed stays here, with the maintainer
 * in his own session. `withholdSecurity` is applied to every snapshot by
 * `snapshotOf`, and `guardText` to every text `publish.ts` uploads by itself
 * (a chat reply, a command's outcome, a request's result or question).
 *
 * THE RULE
 *
 * 1. A security finding is one the `security` agent wrote a line for, or
 *    whose id is `sec-YYYY-MM-DD-NN`. Its detail is RELEASABLE only when
 *    a. its latest line in the findings files says `"status": "resolved"`
 *       AND that line is the `security` agent's own (another agent's line
 *       cannot close a security finding, and any later line reopens it), or
 *    b. a line of it says `"public": true`, whoever wrote it, and no LATER
 *       line says `"public": false` (the mark stays on lines that omit it).
 *    Everything else is WITHHELD: `new`, `open`, `decide`,
 *    `fixed-unverified`, `accepted`, any other word, and an id the findings
 *    files do not have at all.
 * 2. A withheld finding keeps its id, severity, status and first day; its
 *    `detail` and `related` are `null`, and its title is the fixed phrase
 *    `WITHHELD_TITLE` (T-1948, D-456's addition of 2026-11-22: the title of a
 *    withheld security finding is read in the ops files here, nowhere in the
 *    console).
 * 3. Text (the brief, every report, every memory entry, a desk question's
 *    context and options, a chat reply, a command's outcome, a request's
 *    result or question) is redacted where it names a withheld id:
 *    a. a heading that names one: the heading and its whole section (to the
 *       next heading of the same or a higher level; a `#` line inside a
 *       fenced code block is not a heading) become one line;
 *    b. otherwise the BLOCK that names one becomes one line. A block is a
 *       list item with everything indented under it, one table row, or a
 *       paragraph (the lines up to a blank line, a heading, a list item or a
 *       table row); a fenced code block is never split;
 *    c. a redacted paragraph that ends with a colon takes the list items that
 *       follow it too (it introduced them).
 *    The one line is the id, `security`, the severity the findings files
 *    have for it, and a note that the detail is not shown; never the title
 *    (T-1948).
 *    An id is read whatever way it is typed: any case, Persian or Arabic
 *    digits, any dash character, zero-width and direction marks ignored. A
 *    range or a list after an id names every id in it (`-01..03`, `-01–03`,
 *    `-01 to 03`, `-01/02`, `-01, -02`, `-01 and 02`): if ANY of them is
 *    withheld, the block is redacted.
 * 4. The `security` agent's own reports go out with no text, and of its
 *    memory (`.claude/agent-memory/security/`) nothing: one entry says so.
 *
 * The block rule is deliberately coarse: a bullet that names a withheld id
 * among other agents' items goes whole. The charter therefore asks for ONE
 * bullet or row per security finding, never mixed with other items.
 *
 * What the rule does not catch: detail written in a block that does not name
 * the id (a later paragraph, a report section under a heading without the
 * id). The agents' instructions keep such detail next to the id and out of
 * the chat; this is the net under them, not the only guard.
 */

export const SECURITY_AGENT = 'security';

/**
 * Text as ids are looked for in it (never shown): lower case, ASCII digits
 * for Persian and Arabic ones, a plain hyphen for every other dash, and no
 * zero-width or direction mark, so an id is found however it was typed.
 */
export const normalText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));

// All of these read normal text.
const SEC_ID_EXACT = /^(sec-\d{4}-\d{2}-\d{2})-(\d{1,4})$/;
const SEC_ID_IN_TEXT = /(?<![a-z0-9])(sec-\d{4}-\d{2}-\d{2})-(\d{1,4})(?!\d)/g;
/** What may follow an id's number: the day again, a dash, and another number. */
const NEXT_NUMBER = '\\s*(?:(sec-\\d{4}-\\d{2}-\\d{2})-|(-))?\\s*(\\d{1,4})(?!\\d)';
const RANGE_AFTER = new RegExp(`^\\s*(?:\\.{2,3}|…|-|to|until|through|تا)${NEXT_NUMBER}`);
const LIST_AFTER = new RegExp(`^\\s*(?:\\/|,|،|;|؛|&|\\+|and|or|و|یا)${NEXT_NUMBER}`);

const idOf = (day: string, n: number): string => `${day}-${String(n).padStart(2, '0')}`;

/** An id as the ledger keys it: normal text, the charter's number in two digits. */
export function normalId(id: string): string {
  const normal = normalText(id).trim();
  const sec = SEC_ID_EXACT.exec(normal);
  return sec === null ? normal : idOf(sec[1]!, Number(sec[2]));
}

/**
 * Every security id a piece of text names, each once, in order: the ids as
 * written, and every id of a range or a list that follows one (rule 3).
 */
export function securityIdsIn(text: string): string[] {
  const normal = normalText(text);
  const ids = new Set<string>();
  for (const match of normal.matchAll(SEC_ID_IN_TEXT)) {
    const day = match[1]!;
    const width = match[2]!.length;
    let last = Number(match[2]);
    ids.add(idOf(day, last));
    let rest = normal.slice(match.index + match[0].length);
    for (;;) {
      const range = RANGE_AFTER.exec(rest);
      const more = range ?? LIST_AFTER.exec(rest);
      // Another day's id is read on its own by the outer loop.
      if (more === null || (more[1] !== undefined && more[1] !== day)) break;
      // In a list, a bare number counts only when it is written like the id's own.
      const bare = more[1] === undefined && more[2] === undefined;
      if (range === null && bare && more[3]!.length !== width) break;
      const n = Number(more[3]);
      if (range === null) ids.add(idOf(day, n));
      else for (let k = Math.min(last, n); k <= Math.max(last, n); k += 1) ids.add(idOf(day, k));
      last = n;
      rest = rest.slice(more[0].length);
    }
  }
  return [...ids];
}

export const isSecurityFinding = (id: string, agent: string): boolean =>
  agent === SECURITY_AGENT || SEC_ID_EXACT.test(normalText(id).trim());

export interface SecurityFact {
  severity: ConsoleSeverity | null;
  /** As the findings files have it. For this computer only: no text that leaves it carries it while withheld. */
  title: string;
  /** Whether its detail may leave the computer (rule 1). */
  releasable: boolean;
}

/** Every security finding the findings files have, by normal id. */
export type SecurityLedger = ReadonlyMap<string, SecurityFact>;

const SEVERITIES: readonly ConsoleSeverity[] = ['critical', 'major', 'minor', 'info'];
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The ledger from the findings files' lines, in file and line order (rule 1). */
export function securityLedger(
  lines: readonly { record: Record<string, unknown> }[],
): SecurityLedger {
  const seen = new Map<string, SecurityFact & { resolved: boolean; public: boolean }>();
  for (const { record } of lines) {
    const id = str(record.id);
    const agent = str(record.agent);
    if (id === '') continue;
    const key = normalId(id);
    const before = seen.get(key);
    // Once the security agent has written a finding, every later line of that id is its.
    if (before === undefined && !isSecurityFinding(id, agent)) continue;
    // Only the security agent's own latest line closes it; any other latest line reopens it.
    const resolved = record.status === 'resolved' && agent === SECURITY_AGENT;
    // The public mark stays until a later line takes it back.
    const marked =
      record.public === true ? true : record.public === false ? false : (before?.public ?? false);
    seen.set(key, {
      severity: SEVERITIES.find((s) => s === record.severity) ?? before?.severity ?? null,
      title: str(record.title) || before?.title || '',
      resolved,
      public: marked,
      releasable: resolved || marked,
    });
  }
  return new Map(
    [...seen].map(([id, { severity, title, releasable }]) => [id, { severity, title, releasable }]),
  );
}

/** Whether a finding's detail stays on the computer (rule 1). */
export function withholds(ledger: SecurityLedger, id: string, agent: string): boolean {
  const fact = ledger.get(normalId(id));
  return (fact !== undefined || isSecurityFinding(id, agent)) && fact?.releasable !== true;
}

/** The withheld ids a piece of text names, each once, in order. */
export function withheldIdsIn(text: string, ledger: SecurityLedger): string[] {
  const found = new Set(securityIdsIn(text).filter((id) => ledger.get(id)?.releasable !== true));
  // A security finding whose id is not the charter's shape is matched as written.
  const normal = normalText(text);
  for (const [id, fact] of ledger) {
    if (!fact.releasable && !SEC_ID_EXACT.test(id) && normal.includes(id)) found.add(id);
  }
  return [...found];
}

/** Persian: the console shows the text as written (D-352). */
export const WITHHELD_NOTE = 'جزئیات این یافته‌ی امنیتی در کنسول نمایش داده نمی‌شود (D-340).';

/**
 * What a withheld security finding carries in place of its title (T-1948).
 * The same words as `CONSOLE_WITHHELD_FINDING_TITLE` in `@fmip/contracts` (a
 * spec holds them equal), which the server writes over an older publisher's
 * title and the page draws.
 */
export const WITHHELD_TITLE = 'یافته‌ی امنیتی؛ عنوان و جزئیاتش در کنسول نمایش داده نمی‌شود';

/** What the console shows in place of the security agent's memory. Persian, as above. */
export const MEMORY_NOTE = 'حافظه‌ی عامل امنیت در کنسول نمایش داده نمی‌شود (D-340).';

/**
 * The one line a redacted block becomes: each finding's id and severity, and
 * the note. Every id it is given is a withheld one, so no title (T-1948).
 */
export function withheldLine(ids: readonly string[], ledger: SecurityLedger): string {
  const named = ids.map(
    (id) => `[${[id, 'security', ledger.get(id)?.severity].filter(Boolean).join(' · ')}]`,
  );
  return `${named.join(' ؛ ')} — ${WITHHELD_NOTE}`;
}

const HEADING = /^ {0,3}(#{1,6})(?:\s|$)/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const isBlank = (line: string): boolean => line.trim() === '';
const indentOf = (line: string): number => /^\s*/.exec(line)![0].replace(/\t/g, '    ').length;
const endsWithColon = (line: string): boolean => /[:：]\s*(?:\*\*|__|\*|_)?\s*$/.test(line);

/**
 * Which lines are inside a fenced code block, its two fence lines included.
 * A fence closes with the same character, at least as long; one never closed
 * runs to the end.
 */
function fencedLines(lines: readonly string[]): boolean[] {
  const fenced: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const mark = FENCE.exec(line)?.[1];
    if (open === null) {
      fenced.push(mark !== undefined);
      if (mark !== undefined) open = mark;
    } else {
      fenced.push(true);
      if (
        mark !== undefined &&
        mark[0] === open[0] &&
        mark.length >= open.length &&
        line.trim() === mark
      )
        open = null;
    }
  }
  return fenced;
}

type BlockKind = 'heading' | 'blank' | 'row' | 'item' | 'paragraph';
interface Block {
  kind: BlockKind;
  lines: string[];
}

/** The text's lines as blocks (rule 3b). */
function blocksOf(lines: readonly string[]): Block[] {
  const fenced = fencedLines(lines);
  // Inside a fence a line is only text: never a heading, a gap, a row or an item.
  const heading = (i: number): boolean => !fenced[i] && HEADING.test(lines[i]!);
  const blank = (i: number): boolean => !fenced[i] && isBlank(lines[i]!);
  const row = (i: number): boolean => !fenced[i] && TABLE_ROW.test(lines[i]!);
  const item = (i: number): boolean => !fenced[i] && LIST_ITEM.test(lines[i]!);

  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const first = lines[i]!;
    if (heading(i) || blank(i) || row(i)) {
      blocks.push({ kind: heading(i) ? 'heading' : blank(i) ? 'blank' : 'row', lines: [first] });
      i += 1;
      continue;
    }
    const kind: BlockKind = item(i) ? 'item' : 'paragraph';
    const indent = indentOf(first);
    let end = i + 1;
    while (end < lines.length) {
      if (fenced[end]) {
        end += 1;
        continue;
      }
      if (heading(end) || row(end)) break;
      if (blank(end)) {
        // What is indented deeper after the gap still belongs to the block.
        let after = end;
        while (after < lines.length && blank(after)) after += 1;
        const resumes =
          after < lines.length &&
          !heading(after) &&
          !row(after) &&
          indentOf(lines[after]!) > indent;
        if (!resumes) break;
        end = after + 1;
        continue;
      }
      if (item(end) && (kind === 'paragraph' || indentOf(lines[end]!) <= indent)) break;
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

/** How many blocks of a text the rule replaced: one note each. */
export const redactionsIn = (text: string): number => text.split(WITHHELD_NOTE).length - 1;

/**
 * A text on its way to the server by itself (a chat reply, a command's
 * outcome, a request's result or question): the text rule, and which ids it
 * withheld, for `publish.ts` to say on standard error.
 */
export function guardText(
  text: string,
  ledger: SecurityLedger,
): { text: string; withheld: string[] } {
  return { text: redactSecurityText(text, ledger), withheld: withheldIdsIn(text, ledger) };
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
    findings: parts.findings.map(({ releasable: _releasable, ...finding }) =>
      withholds(ledger, finding.id, finding.agent)
        ? { ...finding, title: WITHHELD_TITLE, detail: null, related: null }
        : {
            ...finding,
            detail: finding.detail === null ? null : clean(finding.detail),
            related: finding.related === null ? null : clean(finding.related),
            // T-1907: said to the server, whose own net removes the detail of every
            // security finding that does not carry this, whatever its status.
            ...(isSecurityFinding(finding.id, finding.agent) ? { releasable: true } : {}),
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
    // A desk question's context and options, and the answer shown (an option's label).
    decisions: parts.decisions.map((decision) => ({
      ...decision,
      summary: clean(decision.summary),
      options: decision.options.map((option) => ({ ...option, label: clean(option.label) })),
      answer: decision.answer === null ? null : clean(decision.answer),
    })),
  };
}
