// PreToolUse guard for every session and agent in this repository (T-1682, D-328; hardened T-1684).
// Rules that must not depend on an agent remembering them: CLAUDE.md section 5 (never edit a
// shipped migration), the secrets rule (never read production's .env or a container's
// environment), and the commands that cannot be undone. Exit 2 blocks the call and shows the
// reason to the agent; anything this guard cannot parse is let through (exit 0), so a malformed
// input never stops work. It reads the text of a call: a seatbelt, not a sandbox (a script file
// run elsewhere passes it); the agents' tool lists and the read-only database session are the
// stronger locks. Its cases are guard.cases.json, run by test-guard.mjs.
// Docker Compose commands are judged by their subcommand, never by a word anywhere in the line:
// `docker compose run --rm migrate` is the documented way to migrate and must pass.
import { execFileSync } from 'node:child_process';

/** Compose options that take a value, so the value is not mistaken for the subcommand. */
const COMPOSE_VALUE_OPTIONS = new Set(['-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory', '--ansi', '--progress', '--parallel']);
/** Subcommands that act on every service, Postgres included, when none is named. */
const ALL_SERVICES_IF_NONE = new Set(['restart', 'stop', 'kill', 'pause']);

/** Each `docker compose ...` in the command: its subcommand and the words after it, quotes removed. */
function composeCalls(command) {
  const calls = [];
  const re = /\bdocker(?:-compose|(?:\s+--?[\w-]+(?:[= ](?!compose\b)[^\s-]\S*)?)*\s+compose)\s+([^|;&\n]*)/g;
  for (const m of command.matchAll(re)) {
    const words = m[1].replace(/["'\\]/g, ' ').trim().split(/\s+/).filter(Boolean);
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
    const services = rest.filter((w) => !w.startsWith('-'));
    if (sub === 'down' || sub === 'rm' || sub === 'kill') return `removes or kills production containers (docker compose ${sub})`;
    if (sub === 'config') return 'prints the resolved configuration, every secret included (docker compose config)';
    if (ALL_SERVICES_IF_NONE.has(sub) && services.length === 0) return `${sub}s every service, Postgres included (docker compose ${sub} with no service named)`;
    if (services.includes('postgres') && ['restart', 'stop', 'pause', 'create'].includes(sub)) return `restarts or stops Postgres (docker compose ${sub} postgres; never, T-1472)`;
    const recreate = rest.some((w) => w === '--force-recreate' || w === '--renew-anon-volumes' || w === '-V');
    if (sub === 'up' && recreate && (services.length === 0 || services.includes('postgres'))) return 'recreates Postgres (never, T-1472)';
    if ((sub === 'exec' || sub === 'run') && rest.some((w) => /^(printenv|env|export|set)$/.test(w) || /\/proc\/\S*environ/.test(w))) return 'prints a container\'s environment, which holds the secrets';
  }
  return null;
}

const BLOCKED = [
  // Secrets: production's .env, read or copied in any way; `.env.example` is a template and passes.
  [/\/opt\/fmip\/\.env(?![.\w])|\/opt\/fmip\/\.en[?*[]/, 'reads or copies production\'s .env (secrets are never read; the team charter, rule 1)'],
  [/(fmip-prod|\/opt\/fmip)[\s\S]*(^|[\s'"/=<])(\.env(?![.\w])|\.en[?*[])/, 'reads or copies production\'s .env (secrets are never read; the team charter, rule 1)'],
  [/\bdocker(\s+--?[\w-]+(\s+[^\s-]\S*)?)*\s+(inspect|container\s+inspect)\b/, 'prints a container\'s configuration, its environment and secrets included (docker inspect)'],
  [/\bdocker\s+exec\b[^|;&]*\s(printenv|env|export)(\s|$|['"])/, 'prints a container\'s environment, which holds the secrets'],
  [/\bdocker\s+(restart|stop|kill|rm|pause)\b[^|;&]*postgres/, 'restarts, stops or removes the Postgres container (never, T-1472)'],
  [/\bdocker\s+(volume\s+(rm|prune)\b|system\s+prune\b[^|;&]*--volumes)/, 'deletes Docker volumes (the database lives in one)'],
  [/\bgit(\s+-[Cc]\s+\S+)*\s+push\b[^|;&]*(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/, 'force-pushes'],
  [/\bgit(\s+-[Cc]\s+\S+)*\s+push\b[^|;&]*\s(\S+:)?(refs\/heads\/)?main(\s|$|['"])/, 'pushes to main directly (changes reach main through a merged PR)'],
  [/\s--no-verify\b|\bgit(\s+-[Cc]\s+\S+)*\s+commit\b[^|;&]*\s-[a-zA-Z]*n[a-zA-Z]*\b|core\.hooksPath/, 'skips the git hooks'],
  [/\b(dropdb|dropuser)\b/, 'drops a database or a role'],
  // Only where SQL runs: a commit message or a grep naming DROP TABLE passes.
  [/\bpsql\b[\s\S]*\b(DROP\s+(TABLE|SCHEMA|DATABASE)|TRUNCATE\s+(TABLE\s+)?[a-z_])/i, 'drops or truncates data through psql (a schema change is a reviewed migration)'],
  // A shipped migration changed in place through the shell rather than the Edit tool.
  [/\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i[a-zA-Z.]*\b[^|;&]*packages\/+db\/+migrations\//i, 'edits a migration in place (a shipped one is never edited; use the Edit tool, which checks)'],
];

function migrationPath(filePath) {
  const norm = filePath.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const m = norm.match(/(?:^|\/)(packages\/db\/migrations\/[^/]+\.sql)$/i);
  return m ? m[1].replace(/^packages\/db\/migrations\//i, 'packages/db/migrations/') : null;
}

function shippedMigration(filePath) {
  const path = migrationPath(filePath);
  if (!path) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${path}`], { stdio: 'ignore' });
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
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    const filePath = String(args.file_path ?? '');
    if (shippedMigration(filePath)) {
      block('migration is already on main. Never edit a shipped migration (CLAUDE.md section 5); write a new one');
    }
    // Switching the hooks off, in the shared settings or the git-ignored local ones.
    const text = String(args.content ?? '') + String(args.new_string ?? '') + JSON.stringify(args.edits ?? '');
    if (/[\\/]\.claude[\\/]settings(\.local)?\.json$/.test(filePath) && /disableAllHooks|"hooks"\s*:\s*\{\s*\}/.test(text)) {
      block('turns the repository\'s hooks off');
    }
  }
  process.exit(0);
});
