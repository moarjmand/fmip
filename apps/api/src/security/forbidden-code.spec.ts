import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every 403 the API can answer is `forbidden` (T-907, D-108), read from the
 * source rather than probed, because most refusals need a state a probe
 * cannot reach: a group the caller is not in, a sanction, a paused grant.
 *
 * A `new ForbiddenException(...)` passes when its body is a `ROLE_REFUSALS`
 * entry, `forbidden(...)`, or an `ApiError` whose code is `forbidden` -- or
 * `email_unverified`, which D-108 keeps as its own code. A 403 made any
 * other way (`HttpStatus.FORBIDDEN`, an `HttpException` with 403) fails, so
 * a new refusal cannot ship with another code. `console-security.http.spec.ts`
 * probes the router for the same rule.
 */
const SRC = join(__dirname, '..');
const ALLOWED_CODES = new Set(['forbidden', 'email_unverified']);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** The argument text of the call whose `(` is at `open`. */
function argumentAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i).trim();
    }
  }
  return text.slice(open + 1);
}

/** Why a refusal body is not a `forbidden`, or null when it is. */
function refusalProblem(argument: string, before: string): string | null {
  if (/^ROLE_REFUSALS\.\w+$/.test(argument) || /^forbidden\(/.test(argument)) return null;
  let body = argument;
  if (/^\w+$/.test(argument)) {
    // A name: the nearest `const <name>` above the call is its body.
    const at = before.lastIndexOf(`const ${argument}`);
    if (at === -1) return `names ${argument}, which is not declared above it`;
    body = before.slice(at);
  }
  const code = /error:\s*'(\w+)'/.exec(body)?.[1];
  if (code === undefined) return 'has no error code this check can read';
  return ALLOWED_CODES.has(code) ? null : `answers '${code}'`;
}

describe('every 403 is forbidden (T-907, D-108)', () => {
  const files = sources(SRC).map((path) => ({
    name: relative(SRC, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));

  it('every ForbiddenException carries forbidden (or email_unverified)', () => {
    const problems: string[] = [];
    let calls = 0;
    for (const { name, text } of files) {
      for (const match of text.matchAll(/new ForbiddenException\(/g)) {
        calls += 1;
        const open = match.index + match[0].length - 1;
        const problem = refusalProblem(argumentAt(text, open), text.slice(0, match.index));
        const line = text.slice(0, match.index).split('\n').length;
        if (problem !== null) problems.push(`${name}:${line} ${problem}`);
      }
    }
    // Not vacuous: the scan found the refusals it is about.
    expect(calls).toBeGreaterThan(30);
    expect(problems, '403s with another code: answer forbidden (D-108)').toEqual([]);
  });

  it('no 403 is made any other way', () => {
    const other = files
      .filter(({ text }) => /HttpStatus\.FORBIDDEN|HttpException\([^)]*\b403\b/.test(text))
      .map(({ name }) => name);
    expect(other).toEqual([]);
  });

  it('the rule reads what it should', () => {
    expect(refusalProblem('ROLE_REFUSALS.editor', '')).toBeNull();
    expect(refusalProblem("forbidden('No.')", '')).toBeNull();
    expect(refusalProblem("{ error: 'forbidden', message: 'No.' }", '')).toBeNull();
    expect(refusalProblem("{ error: 'validation', message: 'No.' }", '')).toBe(
      "answers 'validation'",
    );
    const above = "const error: ApiError = { error: 'email_unverified', message: 'Verify.' };\n";
    expect(refusalProblem('error', above)).toBeNull();
    expect(refusalProblem('error', "const error = { error: 'unauthenticated' };")).toBe(
      "answers 'unauthenticated'",
    );
  });
});
