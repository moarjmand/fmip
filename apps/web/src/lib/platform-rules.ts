/**
 * The platform rules on a page (T-931, D-113).
 *
 * A version is stored as plain text (`PlatformRules.body`): paragraphs
 * separated by a blank line, and a paragraph whose every line starts with
 * `- ` is a list. Nothing else is markup, so a published text can never carry
 * HTML onto the page.
 */

export type RulesBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

export function rulesBlocks(body: string): RulesBlock[] {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) =>
      chunk
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    )
    .filter((lines) => lines.length > 0)
    .map((lines): RulesBlock =>
      lines.every((line) => line.startsWith('- '))
        ? { kind: 'list', items: lines.map((line) => line.slice(2).trim()) }
        : { kind: 'paragraph', text: lines.join(' ') },
    );
}

/** A numbered section of the rules: its heading, its anchor and its blocks. */
export interface RulesSection {
  /** The anchor (`#joining`), from the heading's words. */
  id: string;
  /** The block's own lead-in, without its full stop ("Joining"). */
  heading: string;
  blocks: RulesBlock[];
}

/**
 * The versions whose sections a person has checked against the text (T-1789,
 * D-392): every lead-in below is a heading in that text and nothing else is.
 * A version that is not here is shown as plain blocks, as before: a short
 * first sentence is not always a heading ("One account per person."), and a
 * heading that changed what a text says would be a new version every member
 * has to accept (D-113), never navigation.
 */
const SECTIONED_VERSIONS: ReadonlySet<string> = new Set(['platform-rules@1.0.0']);

/** "Joining. You need ..." → "Joining": a few plain words ending in a full stop. */
const LEAD_IN = /^([A-Z][A-Za-z]*(?: [a-z]+){0,6})\.(?: |$)/;

/**
 * The rules in numbered sections (T-1789, D-392), for a version in
 * `SECTIONED_VERSIONS`; `null` for any other, or if its first block has no
 * lead-in. A paragraph that opens on a lead-in starts a section: the lead-in
 * becomes the heading and leaves the paragraph, and nothing else changes, so
 * "heading. rest" is the stored paragraph word for word. Every other block
 * (the lists, "The deletion is recorded ...") stays in the section before it.
 */
export function rulesSections(version: string, body: string): RulesSection[] | null {
  if (!SECTIONED_VERSIONS.has(version)) return null;
  const sections: RulesSection[] = [];
  for (const block of rulesBlocks(body)) {
    const lead = block.kind === 'paragraph' ? LEAD_IN.exec(block.text) : null;
    if (lead !== null && block.kind === 'paragraph') {
      const heading = lead[1]!;
      const rest = block.text.slice(lead[0].length);
      sections.push({
        id: heading.toLowerCase().replace(/ /g, '-'),
        heading,
        blocks: rest === '' ? [] : [{ kind: 'paragraph', text: rest }],
      });
    } else if (sections.length === 0) {
      return null;
    } else {
      sections[sections.length - 1]!.blocks.push(block);
    }
  }
  return sections;
}

/** `platform-rules@1.1.0` → `1.1.0`; anything else is shown as it is. */
export function rulesVersionNumber(version: string): string {
  const at = version.indexOf('@');
  return at === -1 ? version : version.slice(at + 1);
}
