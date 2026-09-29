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

/** `platform-rules@1.1.0` → `1.1.0`; anything else is shown as it is. */
export function rulesVersionNumber(version: string): string {
  const at = version.indexOf('@');
  return at === -1 ? version : version.slice(at + 1);
}
