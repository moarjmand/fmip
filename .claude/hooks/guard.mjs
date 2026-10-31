// PreToolUse guard for every session and agent in this repository (T-1682, D-328).
// Rules that must not depend on an agent remembering them: CLAUDE.md section 5 (never edit a
// shipped migration), the secrets rule (never read production's .env), and the commands that
// cannot be undone. Exit 2 blocks the call and shows the reason to the agent; anything this
// guard cannot parse is let through (exit 0), so a malformed input never stops work.
// Docker Compose commands are judged by their subcommand, never by a word anywhere in the
// line: `docker compose run --rm migrate` is the documented way to migrate and must pass.
import { execFileSync } from 'node:child_process';

/** Compose options that take a value, so the value is not mistaken for the subcommand. */
const COMPOSE_VALUE_OPTIONS = new Set(['-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory', '--ansi', '--progress', '--parallel']);

/** Each `docker compose ...` in the command: its subcommand and the words after it. */
function composeCalls(command) {
  const calls = [];
  const re = /\bdocker(?:-compose|\s+compose)\s+([^|;&\n'"]*)/g;
  for (const m of command.matchAll(re)) {
    const words = m[1].trim().split(/\s+/);
    let i = 0;
    while (i < words.length && words[i].startsWith('-')) {
      i += COMPOSE_VALUE_OPTIONS.has(words[i]) && !words[i].includes('=') ? 2 : 1;
    }
    if (i < words.length) calls.push({ sub: words[i], rest: words.slice(i + 1) });
  }
  return calls;
}

function blockedCompose(command) {
  for (const { sub, rest } of composeCalls(command)) {
    if (sub === 'down' || sub === 'rm' || sub === 'kill') return `removes or kills production containers (docker compose ${sub})`;
    if (sub === 'config') return 'prints the resolved configuration, every secret included (docker compose config)';
    const postgres = rest.includes('postgres');
    if (postgres && ['restart', 'stop', 'pause', 'create'].includes(sub)) return `restarts or stops Postgres (docker compose ${sub} postgres; never, T-1472)`;
    if (postgres && sub === 'up' && rest.some((w) => w === '--force-recreate' || w === '--renew-anon-volumes' || w === '-V')) return 'recreates Postgres (never, T-1472)';
  }
  return null;
}

const BLOCKED = [
  // Secrets: production's .env, read or copied in any way. `.env.example` is a template and passes.
  [/\/opt\/fmip\/\.env(?![.\w])/, 'reads or copies production\'s .env (secrets are never read; the team charter, rule 1)'],
  [/(fmip-prod|\/opt\/fmip)[\s\S]*\b(cat|less|more|head|tail|grep|egrep|sed|awk|cut|strings|cp|scp|rsync|base64|xxd|od|vi|vim|nano|source)\b[^|;&]*(^|[\s'"/=])\.env(?![.\w])/, 'reads or copies production\'s .env (secrets are never read; the team charter, rule 1)'],
  [/\bdocker\s+(restart|stop|kill|rm|pause)\b[^|;&]*postgres/, 'restarts, stops or removes the Postgres container (never, T-1472)'],
  [/\bdocker\s+(volume\s+(rm|prune)\b|system\s+prune\b[^|;&]*--volumes)/, 'deletes Docker volumes (the database lives in one)'],
  [/\bgit\s+push\b[^|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)/, 'force-pushes'],
  [/\bgit\s+push\b[^|;&]*\s(\S+:)?(refs\/heads\/)?main(\s|$|['"])/, 'pushes to main directly (changes reach main through a merged PR)'],
  [/\s--no-verify\b|\bgit\s+commit\b[^|;&]*\s-n\b/, 'skips the git hooks (--no-verify)'],
  // Only where SQL runs: a commit message or a grep naming DROP TABLE passes.
  [/\bpsql\b[\s\S]*\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s+(TABLE\s+)?[a-z_])/i, 'drops or truncates data through psql (a schema change is a reviewed migration)'],
];

function shippedMigration(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  const m = norm.match(/(?:^|\/)(packages\/db\/migrations\/[^/]+\.sql)$/);
  if (!m) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${m[1]}`], { stdio: 'ignore' });
    return true; // on main already: shipped
  } catch {
    return false; // new in this branch: still editable
  }
}

function block(why) {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: this ${why}. Propose it to the maintainer instead.\n`);
  process.exit(2);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const tool = input.tool_name ?? '';
  const args = input.tool_input ?? {};
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(args.command ?? '');
    const compose = blockedCompose(command);
    if (compose) block(`command ${compose}`);
    for (const [re, why] of BLOCKED) if (re.test(command)) block(`command ${why}`);
  }
  if ((tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') && shippedMigration(String(args.file_path ?? ''))) {
    block('migration is already on main. Never edit a shipped migration (CLAUDE.md section 5); write a new one');
  }
  process.exit(0);
});
