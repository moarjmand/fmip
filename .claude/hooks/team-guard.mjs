// PreToolUse guard for the sixteen team agents only (T-1885, D-457 point 1). It stands beside
// guard.mjs, which stays as it is and still judges every call of every session.
//
// Who it judges. The hook input's `agent_type` ("Present when the session uses --agent or the
// hook fires inside a subagent", code.claude.com/docs/en/hooks). A call whose `agent_type` is one
// of the sixteen names below is judged; every other call (the engineering session, a builder,
// general-purpose, claude, Explore, Plan, a missing field) leaves at once with exit 0.
//
// How it fails.
//   - FAIL OPEN for everyone who is not a team agent: input that is not JSON and names no team
//     agent, a missing `agent_type`, an unknown one, all exit 0 before any policy code runs, so a
//     bug here cannot lock the engineering session out.
//   - FAIL CLOSED for a team agent: input that does not parse but carries a team agent's
//     `agent_type`, or any error while judging the call, exits 2 (the call is refused).
//   - What it cannot make fail closed: a syntax error in this file, or a run that outlives the
//     hook's timeout, is a "non-blocking error" to Claude Code and the call goes ahead for
//     everyone. `node .claude/hooks/test-guard.mjs` is the check that this file loads and judges.
//
// What a team agent may do (the policy, in one place):
//   - Edit / Write / MultiEdit / NotebookEdit only under E:/FMIP/ops/, E:/FMIP/data-audit/, the
//     session scratchpad (`scratchpad_dir`, and <temp>/claude/ where scratchpads live) and its own
//     memory folder .claude/agent-memory/<agent>/ (main checkout or a worktree's copy). The path
//     is judged where it really lands: links and junctions on the way are resolved first.
//   - The findings files (E:/FMIP/ops/findings/) have one door, `node
//     .claude/skills/team-charter/bin/finding.mjs` (T-1884). Every other write is refused: the
//     file tools, and from the shell `>`, `>>`, a heredoc into `cat >>`, `tee -a`, Add-Content,
//     Out-File -Append, cp, mv, sed -i, rm, an inline node or python program that names the
//     folder, any program this file does not know that is handed a findings path. Reading them
//     (cat, grep, jq, head, `finding.mjs list`) is free.
//   - Bash / PowerShell: read-only git (an allow-list of verbs), read-only gh (an allow-list), no
//     console write (publish.ts: only lab-check and providers-check), no SQL write through psql,
//     no merge of catalogue entities without --dry-run, no deploy/rollout.sh, no recursive delete
//     outside the scratchpad and temp folders, no shell write to the .claude controls (settings,
//     hooks, agents, skills, another agent's memory), no shell write, copy, move or unpacking
//     into the repository (its own memory apart: a relative redirect after `cd` into the checkout
//     is refused like an Edit; T-1951) nor into the private ops repository outside the roots, no
//     link or junction that touches the repository or the findings folder or whose target holds
//     a root.
//   - The roots themselves (E:/FMIP/ops, E:/FMIP/data-audit, the checkout's .claude/agent-memory),
//     their known targets in the private ops repository (E:/FMIP/fmip-ops/ops and
//     E:/FMIP/fmip-ops/agent-memory) and every folder that holds one are never removed, moved,
//     re-linked or unpacked over: rm, rmdir, mv, ln, mklink, New-Item -ItemType Junction,
//     Remove-Item, `(Get-Item x).Delete()`, tar -x -C (and robocopy /MIR or rsync --delete into
//     one is a removal of a tree). A root's real path is trusted only when it
//     is the root itself or its known target, so a re-pointed junction never widens what may be
//     written (T-1951); the scratchpad's and <temp>/claude's only when they stay in the temp folder.
//   - A shell path is judged as written and where it really lands: links and junctions resolved,
//     and in Git Bash a `..` after a junction applied to its target's parent, as MSYS does (also
//     for the folder a `cd` moved to). PowerShell applies `..` to the text, so for it the text is
//     enough. Every reading is judged; the call is refused if any is refused.
//   - A pull request's code on disk, read-only: `git worktree add [--detach] <path> <ref>`,
//     `git clone --local|--no-hardlinks <this repository> <path>` and `git archive <ref>` (piped
//     to `tar -x -C <path>`, or `-o <file>`), each only with <path> in the scratchpad or the temp
//     folder; `git worktree remove <that path>` and `git worktree prune` to tidy up.
//   - A wrapper is entered where its command can be read (env, command, timeout, cmd /c,
//     bash -c, powershell -Command, find -exec ...); where it cannot (xargs or Start-Process
//     running git, gh, ssh or psql: the arguments come from elsewhere) the call is refused.
//   - The server: only through the five read-only scripts (data-audit/run.sh,
//     ops-check/ops-check.sh, fmip-security/server-hardening.sh, product-strategy/seo-check.sh,
//     search-visibility/structured-data.sh) and the raw `ssh fmip-prod '...'` read shapes in
//     RAW_SSH, which are exactly the ones the agents' files and skills name for ops-release,
//     security and model-scientist. Raw psql on the server is refused
//     whatever it says. A command that names the server and is not one of the above is refused
//     for all sixteen; the name as data (a grep pattern, an echo) is not a command. For
//     chief-of-staff and marketing-manager: never the server, by any of these, and its name on
//     any command line is refused; only a heredoc's body and the findings door may carry it.
//   - The browser (navigate, preview_start, browser_batch): never the agents console or an admin
//     path; content-community, social-media and qa-engineer only our own site and local previews.
//
// It reads the text of a call: a seatbelt, not a sandbox. Residuals, known and accepted:
//   - a script file an agent writes to its scratchpad and then runs is not read;
//   - a shell write outside the repository and the team's folders (`> C:/x`) is not judged; a
//     write target that starts with a variable the guard does not expand (`> "$OUT"`, `$(pwd)/x`)
//     cannot be placed and is judged by its text only; a program the guard does not know that
//     writes through its own options (`curl -o apps/x`) is judged for the findings and another
//     agent's memory only; one file may be removed from the repository (qa-engineer clears
//     `apps/web/tsconfig.tsbuildinfo`), a folder tree may not;
//   - a command built from variables or aliases (`g=git; $g push`, `$g = 'git'; & $g push`), from
//     an encoding (base64 piped to a shell), by dot-sourcing, by Invoke-Expression on a variable,
//     or through an interpreter's own API (`spawn('git', ['push'])`, a string put together in
//     `node -e`) is not recognised; PowerShell's .NET file calls (`[IO.File]::WriteAllText(...)`,
//     `(Get-Item x).Delete()`) are judged by the paths written on their line only;
//   - WebFetch and WebSearch are not limited by host, so data an agent may read can leave in a
//     URL; the browser's javascript_tool is not read either;
//   - a query file given to run.sh is not read (run.sh's read-only session is that lock);
//   - a removal, move or link of a path the guard cannot place (`cd "$D" && rmdir ops`) is
//     judged by its text only;
//   - an agent started as general-purpose (the console chat, until T-1891) is not a team agent
//     to this hook.
// Its cases are team-guard.cases.json, run by test-guard.mjs.
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TEAM = new Set([
  'architect',
  'business-adviser',
  'chief-of-staff',
  'code-reviewer',
  'content-community',
  'data-auditor',
  'designer',
  'growth-analyst',
  'marketing-manager',
  'model-scientist',
  'ops-release',
  'product-strategist',
  'qa-engineer',
  'security',
  'seo-search',
  'social-media',
]);

/** Never the server: no ssh in any shape, none of the five scripts, not its name on a command line. */
const NO_SERVER = new Set(['chief-of-staff', 'marketing-manager']);
/** The browser only on our own site and local previews. */
const OWN_SITE_ONLY = new Set(['content-community', 'social-media', 'qa-engineer']);
const OUR_HOSTS = ['traveltohormuz.ir'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The agents console and the admin pages, as one of a path's first three segments. */
const CLOSED_SEGMENTS = new Set(['agents', 'admin', 'console']);

/** Folders outside the repository the team writes in (the team charter, "Folders"). */
const WRITE_ROOTS = ['e:/fmip/ops', 'e:/fmip/data-audit'];
const FINDINGS = 'e:/fmip/ops/findings';
/**
 * Where the roots really land since 2026-11-21: junctions into the private ops repository. A
 * root's real path is trusted only when it is the root itself or this target (T-1951); the
 * memory folder is `<repository>/.claude/agent-memory`. E:/FMIP/data-audit is a plain folder.
 */
const OPS_REPO = 'e:/fmip/fmip-ops';
const KNOWN_TARGETS = { 'e:/fmip/ops': `${OPS_REPO}/ops`, memory: `${OPS_REPO}/agent-memory` };
const SERVER = 'fmip-prod';

const SERVER_SCRIPT =
  /(^|\/)\.claude\/skills\/(data-audit\/run\.sh|ops-check\/ops-check\.sh|fmip-security\/server-hardening\.sh|product-strategy\/seo-check\.sh|search-visibility\/structured-data\.sh)$/i;
const FINDING_DOOR = /(^|\/)\.claude\/skills\/team-charter\/bin\/finding\.mjs$/i;
const ROLLOUT = /(^|\/)deploy\/rollout\.sh$|^rollout\.sh$/i;

/**
 * The raw read shapes each agent's own file already allows, matched against the whole remote
 * command (one quoted argument after `ssh fmip-prod`). Anchored, with no room for `;`, `|`, `>`,
 * `$(` or a quote: anything else on the server goes through the five scripts.
 */
const RAW_SSH = {
  // ops-release.md: `bash deploy/check-setup.sh` on the server. ops-check/SKILL.md: `git log
  // --oneline -2` on the server (the rollback), `docker system df` and `docker builder du`.
  'ops-release': [
    /^(cd \/opt\/fmip && )?bash deploy\/check-setup\.sh( 2>&1)?$/,
    /^(cd \/opt\/fmip && )?git log --oneline -\d{1,2}( 2>&1)?$/,
    /^docker system df( -v)?( 2>&1)?$/,
    /^docker builder du( 2>&1)?$/,
  ],
  // security.md: "listing, `ss`, `sshd -T`, `ufw status`, `curl -I`" (sudo -n as server-hardening.sh has it).
  security: [
    /^ss -[a-zA-Z]+( 2>&1)?$/,
    /^(sudo -n )?sshd -T( 2>&1)?$/,
    /^(sudo -n )?ufw status( verbose| numbered)?( 2>&1)?$/,
    /^curl -(I|sI|Is)( (-m|--max-time) \d+)? https?:\/\/[\w.:/%?=&~+,@-]+$/,
    /^ls( -[a-zA-Z]+)?( \/[\w./-]*)+( 2>&1)?$/,
  ],
  // model-scientist.md and model-watch/SKILL.md: the lab's logs, `~/fmip-lab/` on the server, read only.
  'model-scientist': [
    /^(ls|cat|head|tail|wc|du|stat)( -[a-zA-Z0-9]+| \d+)*( (~|\$HOME)\/fmip-lab(\/[\w*-][\w.*-]*)*\/?)+( 2>&1)?$/,
  ],
};
const SSH_VALUE_OPTIONS = new Set(['-o', '-i', '-p', '-l', '-F', '-J', '-L', '-R', '-D', '-E', '-b', '-c', '-m', '-S', '-W', '-w', '-B', '-e', '-I', '-O', '-Q']);
const SSH_PLAIN_OPTIONS = new Set(['-n', '-T', '-q', '-4', '-6', '-x', '-a', '-k']);
const SSH_O_VALUES = /^(BatchMode=yes|ConnectTimeout=\d+|ServerAliveInterval=\d+|ServerAliveCountMax=\d+|StrictHostKeyChecking=(yes|accept-new)|LogLevel=\w+)$/i;

/** git verbs that only read. Everything else is refused; the dual-use ones are judged below. */
const GIT_READ = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'rev-list', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file', 'blame', 'annotate',
  'grep', 'shortlog', 'describe', 'merge-base', 'name-rev', 'for-each-ref', 'show-ref', 'show-branch', 'diff-tree', 'diff-index',
  'diff-files', 'range-diff', 'cherry', 'whatchanged', 'verify-commit', 'verify-tag', 'check-ignore', 'check-attr',
  'check-ref-format', 'count-objects', 'var', 'version', 'help', 'fsck', 'fetch', 'branch', 'tag', 'stash', 'worktree', 'remote',
  'config', 'reflog', 'symbolic-ref',
]);
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env', '--attr-source']);
const GIT_LISTING = /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at|--format|--sort|-a|-r|--all|--remotes|-n\d*|-v|--verify)(=.*)?$/;
const GIT_BRANCH_WRITE = /^(-[a-zA-Z]*[dDmMcCfut][a-zA-Z]*|--delete|--move|--copy|--force|--set-upstream-to|--unset-upstream|--edit-description|--track|--no-track|--create-reflog)(=.*)?$/;
const GIT_TAG_WRITE = /^(-[a-zA-Z]*[adsfmFeu][a-zA-Z]*|--annotate|--delete|--sign|--force|--message|--file|--edit|--local-user|--create-reflog|--cleanup)(=.*)?$/;

/** gh commands that only read: group -> verbs (null: every verb). */
const GH_READ = {
  pr: ['list', 'view', 'diff', 'checks', 'status'],
  issue: ['list', 'view', 'status'],
  run: ['list', 'view', 'watch'],
  repo: ['view', 'list'],
  workflow: ['list', 'view'],
  label: ['list'],
  cache: ['list'],
  ruleset: ['list', 'view', 'check'],
  search: null,
  status: null,
  version: null,
  help: null,
};
const PUBLISHER_READ = new Set(['lab-check', 'providers-check']);

const SQL_WRITE =
  /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|MERGE|COPY|REINDEX|VACUUM|REFRESH|CALL|LOCK|SETVAL|NEXTVAL)\b|\bDO\s*\$|transaction_read_only|\bREAD\s+WRITE\b|\\(copy|i|ir|include|o|w|gexec|!)(?![a-z])/i;

/** For text the lexer cannot enter (an interpreter's inline code, a shell fed by a pipe). */
const OPAQUE = [
  [/\bgit(\.exe)?['"]?(\s+-[Cc]\s+\S+)*[\s,'"[(]+(commit|push|pull|merge|rebase|reset|checkout|switch|restore|stash|tag|cherry-pick|revert|apply|am|add|rm|mv|clean|worktree|update-ref)\b/, 'changes the repository or its working tree through git'],
  [/\bgh(\.exe)?['"]?[\s,'"[(]+(pr|issue|release|repo|run|workflow|secret|variable|auth|gist|label|api)\b/, 'calls gh'],
  [/\b(ssh|scp|sftp|rsync)\b|\bfmip-prod\b/, 'reaches another machine'],
  [/\bpsql\b|\bpg_restore\b|\bdropdb\b/, 'runs SQL outside data-audit/run.sh'],
  [/publish\.ts['"]?[\s,'"[(]+(?!lab-check\b|providers-check\b)[a-z]/, 'writes to or syncs the agents console'],
  [/deploy\/rollout\.sh/, 'runs the deploy'],
  [/[\\/]ops[\\/]+findings\b/i, 'names the findings folder (finding.mjs is its only door; read it with cat, grep, jq or `finding.mjs list`)'],
];

const KEYWORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '}', 'time', 'function']);
const READERS = new Set([
  'echo', 'printf', 'cat', 'type', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'head', 'tail', 'less', 'more', 'wc', 'ls', 'll', 'dir',
  'tree', 'jq', 'yq', 'cut', 'sort', 'uniq', 'tr', 'test', '[', '[[', ']]', 'diff', 'cmp', 'comm', 'file', 'stat', 'basename', 'dirname',
  'realpath', 'readlink', 'date', 'sleep', 'true', 'false', 'pwd', 'which', 'where', 'whereis', 'export', 'set', 'unset', 'read',
  'local', 'declare', 'typeset', 'readonly', 'return', 'exit', 'break', 'continue', 'shift', 'for', 'case', 'esac', 'select', 'fi',
  'done', 'wait', 'mkdir', 'df', 'du', 'ps', 'uname', 'whoami', 'hostname', 'id', 'md5sum', 'sha1sum', 'sha256sum', 'xxd', 'od',
  'hexdump', 'strings', 'nl', 'tac', 'rev', 'column', 'fold', 'paste', 'join', 'expr', 'seq', 'clear', 'in',
  'get-content', 'gc', 'get-childitem', 'gci', 'select-string', 'sls', 'write-output', 'write-host', 'test-path', 'get-item',
  'get-date', 'measure-object', 'select-object', 'sort-object', 'where-object', 'foreach-object', 'format-table', 'format-list',
  'out-null', 'out-string', 'convertfrom-json', 'convertto-json', 'get-command', 'resolve-path', 'split-path', 'join-path',
  'start-sleep', 'get-location', 'get-process', 'foreach',
]);
/**
 * Commands whose arguments name files they change. `write`: every argument is a target, judged
 * for the controls and the findings files. `copy`: the destination (the last argument, or
 * -t / -Destination) is the target; `move`: every argument is. For those two the whole
 * repository is closed as well.
 */
const WRITERS = {
  tee: 'write', touch: 'write', truncate: 'write', chmod: 'write', chown: 'write', 'set-content': 'write', sc: 'write',
  'add-content': 'write', ac: 'write', 'out-file': 'write', 'new-item': 'write', ni: 'write', 'clear-content': 'write', clc: 'write',
  cp: 'copy', install: 'copy', 'copy-item': 'copy', cpi: 'copy', copy: 'copy', xcopy: 'copy', robocopy: 'copy',
  mv: 'move', 'move-item': 'move', mi: 'move', move: 'move', 'rename-item': 'move', rni: 'move', ren: 'move',
};
/** PowerShell parameters whose value is not a path. */
const PS_VALUE_PARAMETERS = /^-(value|encoding|filter|include|exclude|itemtype|type|credential|stream|delimiter|width|name)$/i;
const LINK_TYPES = /^(junction|symboliclink|hardlink)$/i;
/** PowerShell's and cmd's redirect targets that are no file (`2> $null`, `> nul`): never "in the repository". */
const NULL_DEVICE = /^(\$null|\$\{null\}|nul:?|con:?)$/i;
/** PowerShell calling .NET to write, remove, move or link a file: the paths on its line are judged. */
const NET_CHANGE =
  /\]::\s*(write|append)all\w*\s*\(|\]::\s*(create\w*|copy|move|delete\w*|replace|setattributes|openwrite)\s*\(|\.\s*(delete|moveto|copyto|createasymboliclink|createsubdirectory|appendtext|createtext|openwrite)\s*\(/i;
const CD_NAMES = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const REMOVERS = new Set(['rm', 'del', 'erase', 'rd', 'rmdir', 'ri', 'remove-item', 'unlink']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'tsx', 'ts-node', 'python', 'python3', 'py', 'perl', 'ruby', 'php', 'lua']);
const AWKS = new Set(['awk', 'gawk', 'mawk']);
const REMOTE_TOOLS = new Set(['scp', 'sftp', 'pscp', 'plink', 'putty', 'mosh', 'telnet', 'autossh', 'sshpass']);
const DB_WRITERS = new Set(['pg_restore', 'createdb', 'dropdb', 'createuser', 'dropuser']);
/** Looked for among the arguments of a command this file does not know (a wrapper it has not met). */
const SENSITIVE = new Set(['git', 'gh', 'ssh', 'scp', 'sftp', 'psql']);

class Deny extends Error {}
const deny = (why) => {
  throw new Deny(why);
};

/**
 * Filled once the caller is known to be a team agent. `memory`: the memory folder's real path
 * when it is the known target (what a write may use); `memoryAny`: wherever it lands now, if
 * outside the repository (what no write may touch). `anchors`: the roots, their known targets
 * and the memory folder, never removed, moved or linked over.
 */
const S = {
  agent: '', tmp: '', home: '', repo: '', memory: '', memoryAny: '', scratch: false, temps: [], shellTemps: [], pool: [],
  writeRoots: WRITE_ROOTS, findings: [FINDINGS], anchors: [],
};

// ---------------------------------------------------------------------------------------------
// Paths. String work only (never node:path), so a verdict is the same on every machine.

/**
 * A path as one lower-case, forward-slash, dot-resolved string: `E:\FMIP\ops`, `E:/FMIP/ops`,
 * `/e/FMIP/ops` (Git Bash) and `/mnt/e/FMIP/ops` (WSL) all become `e:/fmip/ops`. Relative paths
 * are joined to `cwd`; null when the path cannot be placed. `shell` also expands the few
 * variables a shell would (`$TEMP`, `~`, `$CLAUDE_PROJECT_DIR`) and Git Bash's `/tmp`.
 */
function normPath(value, cwd, shell = false) {
  return canonPath(value, cwd, shell)?.toLowerCase() ?? null;
}

/**
 * normPath with the letters' case kept, for the places that ask the file system (realPath).
 * `physical`: a `..` is applied to the real path of what comes before it, as Git Bash (MSYS)
 * does, so `/e/FMIP/ops/..` is E:/FMIP/fmip-ops when E:/FMIP/ops is a junction (T-1951).
 */
function canonPath(value, cwd, shell = false, physical = false) {
  let s = String(value ?? '').trim().replace(/\\/g, '/');
  if (s === '') return null;
  s = s.replace(/^\/\/[?.]\//, '');
  if (shell) {
    s = s
      .replace(/^(\$\{?(env:)?(TEMP|TMP|TMPDIR)\}?|%(TEMP|TMP)%)(?=\/|$)/i, S.tmp)
      .replace(/^(~|\$\{?(env:)?(HOME|USERPROFILE)\}?|%USERPROFILE%)(?=\/|$)/i, S.home)
      .replace(/^(\$\{?(env:)?CLAUDE_PROJECT_DIR\}?|%CLAUDE_PROJECT_DIR%)(?=\/|$)/i, S.repo)
      .replace(/^\/tmp(?=\/|$)/i, S.tmp);
    if (cwd) s = s.replace(/^\$\{?PWD\}?(?=\/|$)/i, cwd);
  }
  s = s.replace(/^\/(mnt|cygdrive)\/([a-zA-Z])(?=\/|$)/, '$2:').replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:');
  if (/^[a-zA-Z]:[^/]/.test(s)) return null; // `E:foo`, relative to that drive's own folder
  if (!/^[a-zA-Z]:(\/|$)/.test(s) && !s.startsWith('/')) {
    if (!cwd) return null;
    s = `${cwd}/${s}`;
  }
  const unc = s.startsWith('//');
  const lead = unc ? '//' : s.startsWith('/') ? '/' : '';
  const out = [];
  for (const part of s.split('/')) {
    const seg = part === '.' || part === '..' ? part : part.replace(/[. ]+$/, ''); // Windows drops trailing dots and spaces
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      const head = `${lead}${out.join('/')}`;
      if (physical && out.length > 0 && resolvable(head)) out.splice(0, out.length, ...realCase(head).split('/').filter(Boolean));
      if (out.length > 1 || (out.length === 1 && !/^[a-zA-Z]:$/.test(out[0]))) out.pop();
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  if (/^[a-zA-Z]:/.test(joined)) return joined;
  return `${unc ? '//' : '/'}${joined}`;
}

/**
 * A path the file system can be asked about without guessing: a drive path, or on a system
 * without drives an absolute one. (On Windows `/usr/x` is Git Bash's own folder, not E:/usr/x.)
 */
const resolvable = (p) => /^[a-zA-Z]:(\/|$)/.test(p) || (process.platform !== 'win32' && p.startsWith('/') && !p.startsWith('//'));

/**
 * Where a path really lands: the real path of the deepest folder on it that exists (links,
 * junctions and 8.3 short names resolved by the file system), then the rest as written. This
 * machine has a junction on C: that points at the project, so the same repository file has two
 * spellings; a junction made under E:/FMIP/ops/ would be a third. Network paths are not asked.
 */
function realCase(canon) {
  if (canon.startsWith('//')) return canon;
  const parts = canon.split('/');
  for (let keep = parts.length; keep >= 1; keep--) {
    const head = parts.slice(0, keep).join('/');
    try {
      const real = realpathSync.native(/^[a-zA-Z]:$/.test(head) || head === '' ? `${head}/` : head);
      return canonPath([real.replace(/\\/g, '/').replace(/\/+$/, ''), ...parts.slice(keep)].join('/'), null) ?? canon;
    } catch {
      // not there (yet): its parent decides
    }
  }
  return canon;
}
const realPath = (canon) => realCase(canon).toLowerCase();

/** Where the shell's process stands for a relative path: Git Bash may stand in a junction's target. */
const pcwdOf = (ctx) => (ctx.pcwd === undefined ? ctx.cwd : ctx.pcwd);

/**
 * Every place a shell path may land, lower-case: as written, and where it really lands; for Git
 * Bash also with each `..` applied physically, from the folder `cd` named and from the one it
 * may have reached (bash's `cd` is logical, but falls back to the physical folder). Empty when
 * the path cannot be placed.
 */
function shellPlaces(raw, ctx) {
  const out = new Set();
  for (const base of new Set([ctx.cwd ?? null, pcwdOf(ctx) ?? null])) {
    for (const physical of ctx.ps ? [false] : [false, true]) {
      const c = canonPath(raw, base, true, physical);
      if (c === null) continue;
      out.add(c.toLowerCase());
      out.add(resolvable(c) ? realPath(c) : c.toLowerCase());
    }
  }
  return [...out];
}

/** A `cd`: the folder as bash names it (logical) and the one Git Bash may really stand in. */
function moveTo(ctx, to) {
  const logical = to === undefined ? null : normPath(to, ctx.cwd, true);
  const physical = to === undefined || ctx.ps ? logical : (canonPath(to, pcwdOf(ctx), true, true)?.toLowerCase() ?? null);
  const clean = (p) => (p !== null && /[$`*?]/.test(p) ? null : p);
  return { cwd: clean(logical), pcwd: clean(physical) };
}

const inside = (root, p) => Boolean(root) && p.startsWith(`${root}/`);
const within = (root, p) => p === root || inside(root, p);
/** The findings folder, as written or where it really lands (E:/FMIP/ops is a junction; T-1949). */
const inFindings = (p) => S.findings.some((root) => within(root, p));
/** The scratchpad and <temp>/claude/ for the file tools; the whole temp folder for the shell. */
const inTemp = (p, roots = S.temps) => roots.some((root) => inside(root, p));

/** Inside `.claude/agent-memory/<agent>/` of the main checkout or of one of its worktrees: whose. */
function memoryOwner(p, memory = S.memory) {
  if (inside(memory, p)) return p.slice(memory.length + 1).match(/^([^/]+)\/./)?.[1] ?? null;
  if (!inside(S.repo, p)) return null;
  const rel = p.slice(S.repo.length + 1).replace(/^\.claude\/worktrees\/[^/]+\//, '');
  const m = rel.match(/^\.claude\/agent-memory\/([^/]+)\/./);
  return m ? m[1] : null;
}

function checkFilePath(value, cwd) {
  const shown = String(value ?? '');
  if (shown.trim() === '') deny('names no file to write');
  const written = canonPath(shown, cwd);
  if (written === null) deny(`writes to a path the guard cannot place (${shown})`);
  if (written.split('/').some((seg, i) => /~\d/.test(seg) || /[*?"<>|]/.test(seg) || (i > 0 && seg.includes(':')))) {
    deny(`writes to a path with a short name, a stream or a wildcard in it (${shown})`);
  }
  const p = realPath(written);
  const lands = p === written.toLowerCase() ? shown : `${shown}, which lands in ${p}`;
  if (inFindings(p)) deny('writes a findings file directly (finding.mjs validates and appends; it is the only door)');
  // The repository first: a checkout that itself lives under the temp folder is still the repository.
  const allowed = within(S.repo, p) || within(S.memory, p) ? memoryOwner(p) === S.agent : S.writeRoots.some((root) => inside(root, p)) || inTemp(p);
  if (!allowed) deny(`writes outside its folders (${lands}); a team agent writes only under E:/FMIP/ops/, E:/FMIP/data-audit/, its scratchpad and its own memory`);
}

const CONTROLS = /(^|\/)\.claude(\/(settings(\.local)?\.json|hooks|agents|skills)(\/.*)?)?$/;
const MEMORY_TEXT = /(^|\/)\.claude\/agent-memory(\/([^/]+))?(\/|$)/;

/** A copy of the repository in the scratchpad (a pull request's tree) is nobody's control or memory. */
const scratchCopyAt = (p) => !within(S.repo, p) && inTemp(p, S.shellTemps);

/** A placed path in another agent's memory (or the memory folder itself), by its text or where it lands. */
function otherMemory(p) {
  const owner = scratchCopyAt(p) ? null : p.match(MEMORY_TEXT);
  if (owner && owner[3] !== S.agent) return true;
  return within(S.memoryAny, p) && memoryOwner(`${p}/x`, S.memoryAny) !== S.agent;
}

/**
 * A path the shell is about to change (a redirect, tee, Set-Content, cp's destination, mv, rm,
 * sed -i, tar -x). Closed: the .claude controls, another agent's memory, the findings files
 * (appending too: finding.mjs is the only door), the whole repository, the agent's own memory
 * apart (T-1951: a shell write is judged like a file tool's), and the private ops repository the
 * roots land in, outside them (its .git/hooks, the maintainer's memory). Each place the path may
 * land is judged (shellPlaces). `mode`: 'write' (all of the above), 'remove' (one file may be
 * removed from the repository, a build file such as tsconfig.tsbuildinfo; a tree may not, see
 * checkRemove), 'maybe' (a word that is only perhaps a path, sed's script: neither repository).
 */
function checkShellTarget(value, ctx, mode = 'write') {
  const raw = String(value ?? '');
  if (ctx.ps && NULL_DEVICE.test(raw.trim())) mode = 'maybe';
  const places = shellPlaces(raw, ctx);
  if (places.length === 0) {
    const text = raw.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (CONTROLS.test(text)) deny('changes the team\'s own controls through the shell (.claude, its settings, hooks, agents or skills)');
    const owner = text.match(MEMORY_TEXT);
    if (owner && owner[3] !== S.agent) deny('changes another agent\'s memory');
    if (/(^|\/)ops\/+findings(\/|$)/.test(text)) {
      deny('writes, moves or removes a findings file from the shell (the only door is `node .claude/skills/team-charter/bin/finding.mjs`)');
    }
    return;
  }
  // `> "$OUT"`: a variable the guard does not expand may well hold an absolute path.
  const t = raw.trim();
  const unplaced = mode === 'maybe' || (/^[$%]/.test(t) && !/^\$\{?PWD\}?([\\/]|$)/i.test(t) && normPath(raw, null, true) === null);
  const closeRepo = !unplaced && mode === 'write';
  for (const p of places) {
    const lands = p === places[0] ? '' : `, which lands in ${p}`;
    if (!unplaced && within(OPS_REPO, p) && !S.writeRoots.some((root) => within(root, p)) && !within(S.memoryAny, p)) {
      deny(`writes, copies, moves, removes or unpacks into the private ops repository outside the team's folders from the shell (${raw}${lands})`);
    }
    if (!scratchCopyAt(p) && CONTROLS.test(p)) deny('changes the team\'s own controls through the shell (.claude, its settings, hooks, agents or skills)');
    if (otherMemory(p)) deny(`changes another agent's memory (${raw}${lands})`);
    if (inFindings(p)) {
      deny(`writes, moves or removes a findings file from the shell (${raw}${lands}; the only door is \`node .claude/skills/team-charter/bin/finding.mjs\`)`);
    }
    if (closeRepo && within(S.repo, p) && memoryOwner(`${p}/x`) !== S.agent) {
      deny(`writes, copies, moves, removes or unpacks into the repository from the shell (${raw}${lands}); a team agent never changes it, only its own memory there`);
    }
  }
}

/**
 * A root of the team's folders, its known target, the memory folder, or a folder that holds one
 * (`strict`: only a folder that holds one): never removed, moved, re-linked or unpacked over, so
 * the junctions the guard trusts stay where they are (T-1951).
 */
function checkAnchor(value, ctx, strict = false) {
  for (const p of shellPlaces(String(value ?? ''), ctx)) {
    const hit = S.anchors.find((a) => (strict ? inside(p, a) : within(p, a)));
    if (hit) {
      deny(`removes, moves, links or unpacks over a root of the team's folders, its target or a folder that holds one (${value}, ${hit}); the junctions E:/FMIP/ops and .claude/agent-memory are the maintainer's`);
    }
  }
}

/** A place a team agent may put a pull request's code or an archive: the scratchpad or the temp folder. */
function checkTempTarget(value, ctx, what) {
  const p = value === undefined ? null : normPath(value, ctx.cwd, true);
  if (p === null || /[$`*?]/.test(p)) deny(`${what} at a path the guard cannot place (${value ?? 'none given'})`);
  for (const q of shellPlaces(value, ctx)) if (within(S.repo, q) || !inTemp(q, S.shellTemps)) deny(`${what} outside the scratchpad and temp folders (${value})`);
}

// ---------------------------------------------------------------------------------------------
// The lexer: a command line as simple commands (words with their quotes removed), the texts of
// `$(...)` and backticks, heredoc bodies and redirect targets. Bash rules, or PowerShell's.

const newCommand = () => ({ words: [], redirects: [], heredocs: [], pipedIn: false, cwdUnknown: false });

/** `text[from]` is just past `$(`: the text up to its closing bracket, and the index after it. */
function readBalanced(text, from, ps) {
  let depth = 1;
  for (let j = from; j < text.length; j++) {
    const ch = text[j];
    if ((ch === '\\' && !ps) || (ch === '`' && ps)) j++;
    else if (ch === "'") {
      const k = text.indexOf("'", j + 1);
      j = k < 0 ? text.length : k;
    } else if (ch === '"') {
      for (j++; j < text.length && text[j] !== '"'; j++) if ((text[j] === '\\' && !ps) || (text[j] === '`' && ps)) j++;
    } else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return [text.slice(from, j), j + 1];
  }
  return [text.slice(from), text.length];
}

function lex(text, ps) {
  const cmds = [];
  const subs = [];
  const pending = [];
  const n = text.length;
  let cur = newCommand();
  let word = null;
  let redir = null;
  let i = 0;

  const add = (s) => {
    word = (word ?? '') + s;
  };
  const endWord = () => {
    if (word === null) return;
    if (redir) cur.redirects.push({ op: redir, target: word });
    else cur.words.push(word);
    redir = null;
    word = null;
  };
  const endCommand = (sep) => {
    endWord();
    redir = null;
    const kept = cur.words.length > 0 || cur.redirects.length > 0 || pending.some((p) => p.cmd === cur);
    const carried = !kept && cur.cwdUnknown; // `(cd x); rm y`: the bracket's mark outlives the empty command after it
    if (kept) cmds.push(cur);
    cur = newCommand();
    cur.pipedIn = sep === '|';
    cur.cwdUnknown = carried || sep === ')' || sep === '}';
  };
  const closeTick = (j) => {
    while (j < n && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
    return Math.min(j, n);
  };
  const readDouble = (j) => {
    add('');
    for (; j < n; j++) {
      const c = text[j];
      if (c === '"') {
        if (ps && text[j + 1] === '"') {
          add('"');
          j++;
          continue;
        }
        return j + 1;
      }
      if (!ps && c === '\\' && j + 1 < n && '$`"\\\n'.includes(text[j + 1])) {
        if (text[j + 1] !== '\n') add(text[j + 1]);
        j++;
      } else if (ps && c === '`' && j + 1 < n) {
        add(text[j + 1]);
        j++;
      } else if (c === '$' && text[j + 1] === '(') {
        const [inner, k] = readBalanced(text, j + 2, ps);
        subs.push(inner);
        add('$()');
        j = k - 1;
      } else if (!ps && c === '`') {
        const k = closeTick(j + 1);
        subs.push(text.slice(j + 1, k));
        add('$()');
        j = k;
      } else add(c);
    }
    return n;
  };
  const readHeredocs = (from) => {
    let pos = from;
    for (const p of pending) {
      let body = '';
      while (pos < n) {
        const eol = text.indexOf('\n', pos);
        const end = eol < 0 ? n : eol;
        const line = text.slice(pos, end).replace(/\r$/, '');
        pos = end + 1;
        if ((p.strip ? line.replace(/^\t+/, '') : line) === p.delim) break;
        body += `${line}\n`;
      }
      p.cmd.heredocs.push(body);
    }
    pending.length = 0;
    return Math.min(pos, n);
  };

  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\n' || ch === '\r') {
      const bodies = ch === '\n' && pending.length > 0;
      endCommand('\n');
      i = bodies ? readHeredocs(i + 1) : i + 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      endWord();
      i++;
      continue;
    }
    if (ps && ch === '<' && next === '#') {
      const k = text.indexOf('#>', i + 2);
      i = k < 0 ? n : k + 2;
      continue;
    }
    if (ch === '#' && word === null) {
      const k = text.indexOf('\n', i);
      i = k < 0 ? n : k;
      continue;
    }
    if (!ps) {
      if (ch === '\\') {
        if (next === '\n') i += 2;
        else if (next === '\r' && text[i + 2] === '\n') i += 3;
        else {
          add(next ?? '');
          i += 2;
        }
        continue;
      }
      if (ch === "'") {
        const k = text.indexOf("'", i + 1);
        const end = k < 0 ? n : k;
        add(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      if (ch === '$' && next === "'") {
        let s = '';
        let j = i + 2;
        for (; j < n && text[j] !== "'"; j++) {
          if (text[j] !== '\\' || j + 1 >= n) {
            s += text[j];
            continue;
          }
          const e = text[++j];
          const hex = e === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(text.slice(j + 1)) : null;
          const oct = /^[0-7]{1,3}/.exec(text.slice(j));
          if (hex) {
            s += String.fromCharCode(parseInt(hex[0], 16));
            j += hex[0].length;
          } else if (oct) {
            s += String.fromCharCode(parseInt(oct[0], 8));
            j += oct[0].length - 1;
          } else s += { n: '\n', t: '\t', r: '\r' }[e] ?? e;
        }
        add(s);
        i = j + 1;
        continue;
      }
      if (ch === '`') {
        const k = closeTick(i + 1);
        subs.push(text.slice(i + 1, k));
        add('$()');
        i = k + 1;
        continue;
      }
      if (ch === '<' && next === '<') {
        endWord();
        if (text[i + 2] === '<') {
          redir = '<<<';
          i += 3;
          continue;
        }
        let j = i + 2;
        const strip = text[j] === '-';
        if (strip) j++;
        while (text[j] === ' ' || text[j] === '\t') j++;
        let delim = '';
        while (j < n && !/[\s;&|<>()]/.test(text[j])) {
          if (text[j] === '\\') {
            delim += text[j + 1] ?? '';
            j += 2;
          } else if (text[j] === "'" || text[j] === '"') {
            const k = text.indexOf(text[j], j + 1);
            const end = k < 0 ? n : k;
            delim += text.slice(j + 1, end);
            j = end + 1;
          } else delim += text[j++];
        }
        pending.push({ delim, strip, cmd: cur });
        i = j;
        continue;
      }
    } else {
      if (ch === '`') {
        if (next === '\n') i += 2;
        else if (next === '\r' && text[i + 2] === '\n') i += 3;
        else {
          add(next ?? '');
          i += 2;
        }
        continue;
      }
      if (ch === '@' && (next === "'" || next === '"') && /^[ \t]*\r?\n/.test(text.slice(i + 2))) {
        const start = text.indexOf('\n', i) + 1;
        const close = text.indexOf(`\n${next}@`, start - 1);
        add(text.slice(start, close < 0 ? n : close).replace(/\r$/, ''));
        i = close < 0 ? n : close + 3;
        continue;
      }
      if (ch === "'") {
        let s = '';
        let j = i + 1;
        for (; j < n; j++) {
          if (text[j] !== "'") s += text[j];
          else if (text[j + 1] === "'") {
            s += "'";
            j++;
          } else break;
        }
        add(s);
        i = j + 1;
        continue;
      }
      if (ch === '{' && word !== null && word.endsWith('$')) {
        const k = text.indexOf('}', i);
        const end = k < 0 ? n : k + 1;
        add(text.slice(i, end));
        i = end;
        continue;
      }
      if (ch === '{' || ch === '}') {
        endCommand(ch);
        i++;
        continue;
      }
    }
    if (ch === '"') {
      i = readDouble(i + 1);
      continue;
    }
    if (ch === '$' && next === '(') {
      const [inner, j] = readBalanced(text, i + 2, ps);
      subs.push(inner);
      add('$()');
      i = j;
      continue;
    }
    if (ch === ';') {
      endCommand(';');
      i++;
      continue;
    }
    if (ch === '|') {
      if (next === '|') {
        endCommand('||');
        i += 2;
      } else {
        endCommand('|');
        i += next === '&' ? 2 : 1;
      }
      continue;
    }
    if (ch === '&') {
      if (next === '&') {
        endCommand('&&');
        i += 2;
      } else if (next === '>') {
        endWord();
        const twice = text[i + 2] === '>';
        redir = twice ? '>>' : '>';
        i += twice ? 3 : 2;
      } else {
        endCommand('&');
        i++;
      }
      continue;
    }
    if (ch === '(' || ch === ')') {
      endCommand(ch);
      i++;
      continue;
    }
    if (ch === '>' || ch === '<') {
      if (word !== null && /^(\d+|\*)$/.test(word)) word = null; // a file descriptor: 2>
      else endWord();
      const twice = ch === '>' && next === '>';
      i += twice ? 2 : 1;
      if (text[i] === '&') {
        for (i++; i < n && /[\d-]/.test(text[i]); i++);
        continue;
      }
      if (text[i] === '(') continue; // <( ... ): the bracket separates it
      if (ch === '>' && text[i] === '|') i++;
      redir = ch === '<' ? '<' : twice ? '>>' : '>';
      continue;
    }
    add(ch);
    i++;
  }
  endCommand('');
  return { cmds, subs };
}

// ---------------------------------------------------------------------------------------------
// Commands.

/** A command word as its program's bare name: `"/c/Program Files/GitHub CLI/gh.exe"` -> `gh`. */
function baseName(word) {
  const s = String(word).replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
}

/** Wrappers that run the command after their own options: what is left once those are gone. */
const WRAPPERS = {
  env(args, ctx) {
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '-S' || a === '--split-string') {
        checkText(args.slice(i + 1).join(' '), ctx.ps, ctx);
        return [];
      }
      if (a === '-u' || a === '-C' || a === '--unset' || a === '--chdir') i++;
      else if (!a.startsWith('-') && !/^[A-Za-z_]\w*=/.test(a)) break;
    }
    return args.slice(i);
  },
  timeout(args) {
    let i = 0;
    for (; i < args.length && args[i].startsWith('-'); i++) if (/^(-k|-s|--kill-after|--signal)$/.test(args[i])) i++;
    return args.slice(i + 1);
  },
  nice: (args) => skipOptions(args, ['-n', '--adjustment']),
  ionice: (args) => skipOptions(args, ['-c', '-n', '-p']),
  sudo: (args) => skipOptions(args, ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-T', '-U']),
  doas: (args) => skipOptions(args, ['-u', '-C']),
  xargs(args) {
    // xargs adds arguments this file never sees: `echo push | xargs git` is a push.
    const rest = skipOptions(args, ['-n', '-I', '-P', '-d', '-L', '-s', '-a', '-E']);
    const program = baseName(rest[0] ?? '');
    if (SENSITIVE.has(program)) deny(`runs ${program} through xargs, which hands it arguments the guard cannot see`);
    if (REMOVERS.has(program) && rest.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || /^-r/i.test(a) || a === '--recursive')) {
      deny('removes folder trees named by xargs, which the guard cannot place');
    }
    return rest;
  },
  watch: (args) => skipOptions(args, ['-n', '--interval']),
  exec: (args) => skipOptions(args, ['-a']),
  wsl: (args) => skipOptions(args, ['-d', '-u', '--distribution', '--user', '--cd']),
  command: (args) => (args.some((a) => a === '-v' || a === '-V') ? [] : skipOptions(args, [])),
  nohup: (args) => args,
  setsid: (args) => skipOptions(args, []),
  stdbuf: (args) => skipOptions(args, []),
  winpty: (args) => skipOptions(args, []),
  builtin: (args) => args,
  unbuffer: (args) => args,
  call: (args) => args,
};

function skipOptions(args, withValue) {
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (args[i] === '--') {
      i++;
      break;
    }
    if (withValue.includes(args[i])) i++;
  }
  return args.slice(i);
}

/** One command line, and every command line nested in it. `ctx.full` stays the outermost text. */
function checkText(text, ps, ctx) {
  const depth = (ctx.depth ?? 0) + 1;
  if (depth > 8) deny('nests commands deeper than the guard reads');
  const { cmds, subs } = lex(String(text), ps);
  // A .NET call that writes, removes, moves or links (`(Get-Item x).Delete()`): every path on the line.
  const net = ps && (ctx.net === true || NET_CHANGE.test(String(text)));
  const inner = { ...ctx, ps, depth, net };
  for (const sub of subs) checkText(sub, ps, { ...inner });
  for (const cmd of cmds) {
    if (cmd.cwdUnknown) {
      inner.cwd = null;
      inner.pcwd = null;
    }
    if (net) checkNetWords(cmd.words, inner);
    checkSimple(cmd.words, cmd, inner);
  }
}

/** The words of a PowerShell line that calls .NET to change files: each path a target, each word a possible root. */
function checkNetWords(words, ctx) {
  if (CD_NAMES.has(baseName(words[0] ?? ''))) return;
  for (const w of words) {
    const word = w.replace(/[,;]+$/, '');
    if (word === '' || word.startsWith('-')) continue;
    checkAnchor(word, ctx);
    if (/[\\/]|^[a-zA-Z]:|^\.\.?$|^~|^\$(env:|home\b|pwd\b)/i.test(word)) checkShellTarget(word, ctx);
  }
}

function rawScan(text, what) {
  for (const [re, why] of OPAQUE) if (re.test(String(text))) deny(`${what} whose text ${why}; the guard cannot read further into it`);
  if (namesOtherMemory(String(text))) {
    deny(`${what} whose text names another agent's memory or the memory folder itself (its own, .claude/agent-memory/${S.agent}/, it may name); the guard cannot read further into it`);
  }
}

/** Text that names `agent-memory` followed by anything but this agent's own folder, or with a `..` after it. */
function namesOtherMemory(text) {
  for (const m of text.matchAll(/agent-memory((?:[\\/]+[^\\/\s'"`,;:()<>|&{}[\]]*)*)/gi)) {
    const segs = m[1].split(/[\\/]+/).filter(Boolean);
    if ((segs[0] ?? '').toLowerCase() !== S.agent || segs.includes('..')) return true;
  }
  return false;
}

function checkScriptFile(file) {
  const p = String(file ?? '').replace(/\\/g, '/');
  if (ROLLOUT.test(p)) deny('runs the deploy (deploy/rollout.sh)');
  if (SERVER_SCRIPT.test(p) && NO_SERVER.has(S.agent)) deny(`has no reason to reach the server (${p})`);
}

function checkSimple(allWords, cmd, ctx) {
  for (const r of cmd?.redirects ?? []) if (r.op === '>' || r.op === '>>') checkShellTarget(r.target, ctx);
  let w = allWords.slice();
  for (let turns = 0; ; turns++) {
    if (w.length === 0) return;
    if (turns > 24) deny('wraps a command deeper than the guard reads');
    if (!ctx.ps && /^[A-Za-z_]\w*\+?=/.test(w[0])) {
      if (/\bfmip-prod\b|\bssh:\/\//i.test(w[0])) deny('points a command at the server through its environment');
      w = w.slice(1);
    } else if (ctx.ps && /^\$[\w:{}.]+$/.test(w[0]) && /^[+-]?=$/.test(w[1] ?? '')) w = w.slice(2); // $x = <a command or a value>
    else if (KEYWORDS.has(w[0])) w = w.slice(1);
    else if (Object.hasOwn(WRAPPERS, baseName(w[0]))) w = WRAPPERS[baseName(w[0])](w.slice(1), ctx);
    else break;
  }
  const name = baseName(w[0]);
  const args = w.slice(1);
  const c = cmd ?? newCommand();

  // The findings door: its arguments are a finding's words (evidence often quotes a command).
  if (name === 'node') {
    const file = args.find((a) => !a.startsWith('-')) ?? '';
    const placed = normPath(file, ctx.cwd, true);
    if (FINDING_DOOR.test(placed ?? file.replace(/\\/g, '/')) && (placed === null || inside(S.repo, placed))) return;
  }
  // For the two that never reach the server, its name on any command line is refused, a grep's
  // included; only a heredoc's body (a report's text) and the findings door may carry it.
  if (NO_SERVER.has(S.agent) && [...w, ...c.redirects.map((r) => r.target)].some((x) => /fmip-prod/i.test(x))) {
    deny('has no reason to reach the server (the command names it)');
  }

  if (CD_NAMES.has(name)) {
    Object.assign(ctx, moveTo(ctx, args.find((a) => !a.startsWith('-')))); // both are judged, `cd -P` or not
    return;
  }
  if (name === 'git') return checkGit(args, ctx);
  if (name === 'gh') return checkGh(args);
  if (name === 'ssh') return checkSsh(args);
  if (REMOTE_TOOLS.has(name)) deny(`reaches another machine with ${name} (the server is read only through the five read-only scripts)`);
  if (name === 'rsync' && args.some((a) => a === '-e' || /^[\w.-]+@|^[\w.-]{2,}:/.test(a))) deny('copies to or from another machine with rsync');
  if (name === 'rsync' && args.some((a) => /^--(delete|remove-source-files)/.test(a))) {
    // It removes what the source lacks (or the sources themselves): a removal of a tree.
    const plain = args.filter((a) => !a.startsWith('-'));
    for (const t of args.some((a) => a.startsWith('--remove-source-files')) ? plain : plain.slice(-1)) checkRemove('rm', ['-r', t], ctx);
  }
  if (name === 'psql') return checkPsql(args, c, ctx);
  if (DB_WRITERS.has(name)) deny(`changes a database (${name})`);
  if (SHELLS.has(name)) return checkShell(args, c, ctx);
  if (name === 'eval' || name === 'invoke-expression' || name === 'iex') return checkText(args.join(' '), ctx.ps, ctx);
  if (name === 'alias' || name === 'set-alias' || name === 'sal' || name === 'new-alias') {
    for (const a of args) checkText(a.includes('=') ? a.slice(a.indexOf('=') + 1) : a, ctx.ps, ctx);
    return;
  }
  if (name === 'source' || name === '.') return checkScriptFile(args[0]);
  if (name === 'powershell' || name === 'pwsh') return checkPowerShell(args, c, ctx);
  if (name === 'cmd') {
    // cmd keeps backslashes, as PowerShell does: its line is read by those rules.
    const at = args.findIndex((a) => /^\/[ck]$/i.test(a));
    if (at >= 0) checkText(args.slice(at + 1).join(' '), true, ctx);
    return;
  }
  if (name === 'start-process' || name === 'saps') {
    // Its program's arguments are a list the shell builds (-ArgumentList 'push origin main').
    const named = args.findIndex((a) => /^-filepath$/i.test(a));
    const program = baseName(named >= 0 ? (args[named + 1] ?? '') : (args.find((a) => !a.startsWith('-')) ?? ''));
    if (SENSITIVE.has(program)) deny(`starts ${program} through Start-Process, whose arguments the guard does not resolve`);
    return checkGeneric(w, c, ctx);
  }
  if (name === 'find') return checkFind(args, ctx);
  if (REMOVERS.has(name)) return checkRemove(name, args, ctx);
  if (AWKS.has(name)) return rawScan(args.join(' '), 'runs an awk program');
  if (name === 'sed' || name === 'perl') {
    if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) {
      // The script (`s/a/b/`) is no file in the repository; the files after it are changed in place.
      const { script, files } = inPlaceOperands(name, args);
      for (const a of script) checkShellTarget(a, ctx, 'maybe');
      for (const a of files) checkShellTarget(a, ctx);
    }
    if (name === 'sed') return;
  }
  if (name === 'sort') {
    const at = args.findIndex((a) => a === '-o' || a === '--output');
    if (at >= 0) checkShellTarget(args[at + 1], ctx);
    return;
  }
  if (name === 'dd') {
    for (const a of args) if (a.startsWith('of=')) checkShellTarget(a.slice(3), ctx);
    return;
  }
  if (name === 'ln' || name === 'mklink' || name === 'junction' || name === 'junction64') {
    return checkLink(args.filter((a) => !a.startsWith('-') && !/^\/[a-zA-Z]$/.test(a)), ctx);
  }
  if (name === 'fsutil' && /^(hardlink|reparsepoint)$/i.test(args[0] ?? '')) return checkLink(args.slice(2), ctx);
  if (name === 'tar' || name === 'bsdtar') return checkTar(args, ctx);
  if (Object.hasOwn(WRITERS, name)) return checkWriter(name, args, ctx);
  if (READERS.has(name)) return;
  if (INTERPRETERS.has(name)) return checkInterpreter(name, w, c, ctx);
  return checkGeneric(w, c, ctx);
}

/**
 * `sed -i` / `perl -pi`: the script (the first operand, or the values of -e / -f) and the files.
 * A short option cluster ends at `i` (its suffix follows) or at an option that takes a value.
 */
function inPlaceOperands(name, args) {
  const operands = [];
  const script = [];
  let scripted = false;
  const scriptOption = name === 'sed' ? 'ef' : 'eE';
  const valueOption = name === 'sed' ? 'l' : 'MmIxdDC0l';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (/^--(expression|file)=/.test(a)) {
      scripted = true;
      script.push(a.slice(a.indexOf('=') + 1));
    } else if (/^--(expression|file)$/.test(a)) {
      scripted = true;
      script.push(args[++i] ?? '');
    } else if (a === '--line-length') i++;
    else if (/^-[^-]/.test(a)) {
      for (let k = 1; k < a.length; k++) {
        if (a[k] === 'i') break;
        if (scriptOption.includes(a[k])) {
          scripted = true;
          script.push(k === a.length - 1 ? (args[++i] ?? '') : a.slice(k + 1));
          break;
        }
        if (valueOption.includes(a[k])) {
          if (name === 'sed' && k === a.length - 1) i++; // `-l 80`; perl's values are attached
          break;
        }
      }
    } else if (!a.startsWith('-')) operands.push(a);
  }
  return scripted ? { script, files: operands } : { script: operands.slice(0, 1), files: operands.slice(1) };
}

const PS_WRITERS = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file', 'clear-content', 'clc', 'new-item', 'ni']);
/** PowerShell parameters naming the file (-Path, -LiteralPath, -FilePath and their prefixes). */
const PS_PATH_PARAMETER = /^-(p(a(th?)?)?|pspath|lp|li(t(e(r(a(l(p(a(th?)?)?)?)?)?)?)?)?|f(i(l(e(p(a(th?)?)?)?)?)?)?)$/i;
/** Common PowerShell parameters with a value that is no path. */
const PS_COMMON_VALUES = /^-(inputobject|io|erroraction|ea|warningaction|wa|errorvariable|ev|outvariable|ov|informationaction|infa|informationvariable|iv|outbuffer|ob|pipelinevariable|pv)$/i;
/** Options of the shell's writers whose value is no file to change. */
const WRITE_VALUES = { touch: /^(-[dtr]|--date|--reference)$/, truncate: /^(-[sr]|--size|--reference)$/ };

/**
 * The files a `write` command changes, and the words that are only perhaps paths: Set-Content's
 * value (`Set-Content <file> x`), Out-File's encoding, chmod's mode, touch -d's date, truncate -s's
 * size. The second are judged without the repository closures, as every word was before T-1951.
 */
function writeOperands(name, args, paths) {
  if (PS_WRITERS.has(name)) {
    const named = [];
    const positional = [];
    const common = [];
    for (let i = 0; i < args.length; i++) {
      if (PS_PATH_PARAMETER.test(args[i])) named.push(args[++i] ?? '');
      else if (PS_VALUE_PARAMETERS.test(args[i])) i++;
      else if (PS_COMMON_VALUES.test(args[i])) common.push(args[++i] ?? '');
      else if (!args[i].startsWith('-')) positional.push(args[i]);
    }
    return named.length > 0
      ? { files: named, others: [...positional, ...common] }
      : { files: positional.slice(0, 1), others: [...positional.slice(1), ...common] };
  }
  if (name === 'chmod' || name === 'chown') {
    return args.some((a) => a.startsWith('--reference')) ? { files: paths, others: [] } : { files: paths.slice(1), others: paths.slice(0, 1) };
  }
  const values = WRITE_VALUES[name];
  if (values === undefined) return { files: paths, others: [] };
  const files = [];
  const others = [];
  for (let i = 0; i < args.length; i++) {
    if (values.test(args[i])) others.push(args[++i] ?? '');
    else if (!args[i].startsWith('-')) files.push(args[i]);
  }
  return { files, others };
}

/** The path arguments of a command, with the values of PowerShell's non-path parameters left out. */
function pathArguments(args) {
  const paths = [];
  let destination = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (PS_VALUE_PARAMETERS.test(a)) i++;
    else if (/^(-t|--target-directory|-dest\w*)$/i.test(a)) destination = args[++i] ?? null;
    else if (/^--target-directory=/.test(a)) destination = a.slice(a.indexOf('=') + 1);
    else if (!a.startsWith('-') && !/^\/[a-zA-Z]$/.test(a)) paths.push(a);
  }
  return { paths, destination };
}

function checkWriter(name, args, ctx) {
  const kind = WRITERS[name];
  // `-ItemType Junction`, `-It SymbolicLink`, `-Type:HardLink`: any word naming a link type makes it a link.
  if ((name === 'new-item' || name === 'ni') && args.some((a) => LINK_TYPES.test(a.replace(/^-\w*:/, '')))) {
    return checkLink(args.filter((a) => !a.startsWith('-') && !LINK_TYPES.test(a)), ctx);
  }
  const { paths, destination } = pathArguments(args);
  if (kind === 'write') {
    const { files, others } = writeOperands(name, args, paths);
    for (const t of files) checkShellTarget(t, ctx);
    for (const t of others) checkShellTarget(t, ctx, 'maybe');
  }
  if (kind === 'move') {
    for (const t of [...paths, ...(destination === null ? [] : [destination])]) {
      checkAnchor(t, ctx);
      checkShellTarget(t, ctx);
    }
  }
  if (kind === 'copy') {
    // The sources are only read; with one path and no -t there is no destination to judge.
    // Copying into a root (`cp raid.md E:/FMIP/ops/`) leaves it where it is; over a folder that holds one, never.
    // robocopy names its destination second, and /MIR or /PURGE removes what the source lacks: a removal.
    const robocopy = name === 'robocopy';
    const to = destination ?? (robocopy ? (paths.filter((a) => !/^\/[a-z]+(:[^/\\]*)?$/i.test(a))[1] ?? null) : paths.length > 1 ? paths.at(-1) : null);
    if (robocopy && to !== null && args.some((a) => /^\/(mir|purge)$/i.test(a))) checkRemove('rmdir', ['/s', to], ctx);
    if (to !== null) {
      checkAnchor(to, ctx, true);
      checkShellTarget(to, ctx);
    }
  }
}

/**
 * A new link, junction or hard link (`ln`, `mklink`, `New-Item -ItemType Junction`): through one
 * a later Write under E:/FMIP/ops/ could land in the repository. Neither end may be the
 * repository, the memory folder or the findings folder, a root, its target or a folder that holds
 * one (`ln -s E:/FMIP/fmip-ops <ops>/j`, `mklink /J E:/FMIP/ops E:/`; T-1951), and both must be
 * paths the guard can place.
 */
function checkLink(paths, ctx) {
  for (const raw of paths) {
    const p = normPath(raw, ctx.cwd, true);
    if (p === null || /[$`*?]/.test(p)) deny(`makes a link with an end the guard cannot place (${raw})`);
    for (const q of shellPlaces(raw, ctx)) {
      if (within(S.repo, q) || within(S.memoryAny, q) || inFindings(q)) deny(`makes a link or junction that touches the repository or the findings folder (${raw})`);
    }
    checkAnchor(raw, ctx);
    checkShellTarget(raw, ctx);
  }
}

/** Unpacking (`git archive <ref> | tar -x -C <scratchpad>`): never into the repository. */
function checkTar(args, ctx) {
  const first = args[0] ?? '';
  const extracts = args.some((a) => a === '--extract' || a === '--get' || /^-[a-zA-Z]*x/.test(a)) || /^[a-zA-Z]*x[a-zA-Z]*$/.test(first);
  if (!extracts) return;
  let into = '.';
  for (let i = 0; i < args.length; i++) {
    if (/^(-[a-zA-Z]*C|--directory|--cd)$/.test(args[i])) into = args[i + 1] ?? '';
    else if (/^--directory=/.test(args[i])) into = args[i].slice(12);
  }
  const p = normPath(into, ctx.cwd, true);
  if (p === null || /[$`*?]/.test(p)) deny(`unpacks an archive at a path the guard cannot place (${into})`);
  checkAnchor(into, ctx); // an entry named like a root could replace its junction
  checkShellTarget(into, ctx);
}

/** A program this file has no rule for: look for what it could be carrying. */
function checkGeneric(w, c, ctx) {
  checkScriptFile(w[0]);
  // Handed a findings path, or another agent's memory, it may write there: only the readers and
  // finding.mjs may name one (T-1951 for the memory, as node -e).
  for (const x of w.slice(1)) {
    const value = x.includes('=') && x.startsWith('-') ? x.slice(x.indexOf('=') + 1) : x;
    const places = shellPlaces(value, ctx);
    if (places.length > 0 ? places.some(inFindings) : /(^|[\\/])ops[\\/]+findings([\\/]|$)/i.test(value)) {
      deny(`hands ${baseName(w[0])} a findings path (${value}); the only door for writing is finding.mjs, and cat, grep, jq read`);
    }
    const text = value.replace(/\\/g, '/').toLowerCase().match(MEMORY_TEXT);
    if (places.length > 0 ? places.some(otherMemory) : Boolean(text && text[3] !== S.agent)) {
      deny(`hands ${baseName(w[0])} another agent's memory (${value}); cat, grep and jq read it`);
    }
  }
  const at = w.findIndex((x) => /(^|[\\/])publish\.ts$/i.test(x));
  if (at >= 0 && !PUBLISHER_READ.has(w[at + 1] ?? '')) {
    deny(`writes to or syncs the agents console (publish.ts ${w[at + 1] ?? ''}; only lab-check and providers-check are read-only)`);
  }
  if (w.some((x) => /(^|[\\/])catalog\.(mjs|cjs|js|ts)$/i.test(x)) && w.some((x) => /^--(merge-[\w-]+|unmerge[\w-]*|not-duplicate)(=|$)/.test(x)) && !w.includes('--dry-run')) {
    deny('merges, unmerges or marks catalogue entities without --dry-run');
  }
  for (const a of w.slice(1)) if (/\s|[;&|`]|\$\(/.test(a)) checkText(a, ctx.ps, ctx);
  for (let i = 1; i < w.length; i++) {
    if (w[i].includes('://') || !SENSITIVE.has(baseName(w[i]))) continue;
    // What follows is that program's command line, however the wrapper was handed it (one quoted
    // string, a comma list); what the wrapper reads on its input, the program reads too.
    const carried = w.slice(i + 1).flatMap((x) => x.split(/[\s,]+/)).filter(Boolean);
    const input = { ...newCommand(), heredocs: c.heredocs, pipedIn: c.pipedIn, redirects: c.redirects.filter((r) => r.op === '<' || r.op === '<<<') };
    checkSimple([w[i], ...carried], input, { ...ctx, embedded: true });
    break;
  }
  if (w.some((x) => /\bfmip-prod\b|\bssh:\/\//i.test(x))) deny('names the server in a command that is not one of the read-only scripts');
}

function checkGit(args, outer) {
  let ctx = outer;
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (/^(--version|--help|-h|-v)$/.test(args[i])) return;
    if (args[i] === '-C') ctx = { ...ctx, ...moveTo(ctx, args[i + 1] ?? '') }; // relative paths start there
    if (GIT_VALUE_OPTIONS.has(args[i])) i++;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === undefined) return;
  if (ctx.embedded && !/^[a-z][a-z-]*$/.test(sub)) return; // a word that only looks like git among another program's arguments
  if (args.some((a) => /\bfmip-prod\b|\bssh:\/\//i.test(a))) deny('reaches the server through git');
  const flags = rest.filter((a) => a.startsWith('-'));
  const plain = rest.filter((a) => !a.startsWith('-'));
  const no = (what) => deny(`runs "git ${sub}" in a form that ${what}`);
  // A pull request's code on disk, read-only: only into the scratchpad or the temp folder.
  if (sub === 'clone') {
    const odd = flags.find((a) => !/^(-l|--local|--no-hardlinks|-q|--quiet|-n|--no-checkout|--single-branch|--no-single-branch|--no-tags|--depth(=\d+)?|-b|--branch(=.+)?)$/.test(a));
    if (odd) no(`passes an option outside the plain ones (${odd})`);
    const paths = rest.filter((a, k) => !a.startsWith('-') && !/^(--depth|-b|--branch)$/.test(rest[k - 1] ?? ''));
    const source = String(paths[0] ?? '').replace(/^file:\/\//i, '');
    const elsewhere = /^[a-z][a-z0-9+.-]*:\/\/|^[\w.-]+@|^[\w.-]{2,}:/i.test(source); // a URL, or host:path
    const from = elsewhere ? null : normPath(source, ctx.cwd, true);
    if (paths.length !== 2 || from === null || !within(S.repo, from)) no('clones anything but this repository, or names no place for the copy');
    return checkTempTarget(paths[1], ctx, 'clones the repository');
  }
  if (sub === 'worktree' && plain[0] === 'add') {
    const odd = flags.find((a) => !/^(--detach|-d|-q|--quiet|--no-checkout|--checkout)$/.test(a));
    if (odd) no(`makes or forces a branch, or passes an option outside the plain ones (${odd})`);
    // Without --detach a bare name takes that branch for the new worktree (nobody else can then
    // check it out) or makes one from the remote's; a remote ref, FETCH_HEAD or a commit detaches.
    const detached = flags.some((a) => a === '--detach' || a === '-d') || /^(origin\/.+|refs\/(remotes|tags|pull)\/.+|FETCH_HEAD|HEAD|[0-9a-f]{7,40})$/.test(plain[2] ?? '');
    if (!detached) no('would take or make a branch (say --detach, or give origin/<branch>, FETCH_HEAD or a commit)');
    return checkTempTarget(plain[1], ctx, 'adds a worktree');
  }
  if (sub === 'worktree' && plain[0] === 'remove') return checkTempTarget(plain[1], ctx, 'removes a worktree');
  if (sub === 'worktree' && plain[0] === 'prune') return undefined;
  if (sub === 'archive') {
    const remote = flags.find((a) => /^(--remote|--exec)(=|$)/.test(a));
    if (remote) no(`reaches another repository (${remote})`);
    for (let k = 0; k < rest.length; k++) {
      const out = /^(-o|--output)$/.test(rest[k]) ? rest[k + 1] : (/^(?:--output=|-o)(.+)$/.exec(rest[k])?.[1] ?? null);
      if (out !== null) checkTempTarget(out, ctx, 'writes an archive');
    }
    return undefined;
  }
  if (!GIT_READ.has(sub)) deny(`runs "git ${sub}", which is not one of the read-only git commands (a team agent never changes the repository or its working tree)`);
  const listing = flags.some((a) => GIT_LISTING.test(a));
  if (sub === 'branch' && (flags.some((a) => GIT_BRANCH_WRITE.test(a)) || (plain.length > 0 && !listing))) no('creates, moves or deletes a branch');
  if (sub === 'tag' && (flags.some((a) => GIT_TAG_WRITE.test(a)) || (plain.length > 0 && !listing))) no('creates or deletes a tag');
  if (sub === 'stash' && plain[0] !== 'list' && plain[0] !== 'show') no('changes the working tree or the stash');
  if (sub === 'worktree' && plain[0] !== 'list') no('adds or removes a worktree');
  if (sub === 'remote' && plain.length > 0 && plain[0] !== 'show' && plain[0] !== 'get-url') no('changes the remotes');
  if (sub === 'reflog' && /^(expire|delete|drop|write)$/.test(plain[0] ?? '')) no('rewrites the reflog');
  if (sub === 'symbolic-ref' && (plain.length > 1 || flags.some((a) => /^(-d|--delete|-m)$/.test(a)))) no('moves a ref');
  if (sub === 'fetch' && plain.slice(1).some((a) => a.includes(':') && !/^\+?[^:]*:refs\/remotes\//.test(a))) no('writes a local branch');
  if (sub === 'config') {
    const reads = flags.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list)$/.test(a)) || plain[0] === 'get' || plain[0] === 'list';
    const writes = flags.some((a) => /^(--add|--unset|--unset-all|--replace-all|--rename-section|--remove-section|-e|--edit)$/.test(a)) || /^(set|unset|edit|rename-section|remove-section)$/.test(plain[0] ?? '');
    if (writes || (!reads && plain.length > 1)) no('changes git configuration');
  }
}

function checkGh(args) {
  const plain = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-R' || args[i] === '--repo') i++;
    else if (!args[i].startsWith('-')) plain.push(args[i]);
  }
  const [group, verb] = plain;
  if (group === undefined) return;
  if (group === 'api') {
    const writes = args.some((a, i) => {
      if (/^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a)) return true;
      const method = /^(-X|--method)$/.test(a) ? args[i + 1] : (/^(?:-X|--method=)(.+)$/.exec(a)?.[1] ?? null);
      return method !== null && String(method).toUpperCase() !== 'GET';
    });
    if (writes) deny('writes to GitHub through gh api (a method other than GET, or a field)');
    return;
  }
  if (!Object.hasOwn(GH_READ, group)) deny(`runs "gh ${group}", which is not one of the read-only gh commands`);
  const verbs = GH_READ[group];
  if (verbs !== null && verb !== undefined && !verbs.includes(verb)) deny(`runs "gh ${group} ${verb}", which writes to GitHub or changes the working tree`);
}

function checkSsh(args) {
  if (NO_SERVER.has(S.agent)) deny('has no reason to reach the server');
  const options = [];
  let i = 0;
  for (; i < args.length && args[i].startsWith('-'); i++) {
    if (SSH_VALUE_OPTIONS.has(args[i])) options.push([args[i], args[++i] ?? '']);
    else if (/^-o./.test(args[i])) options.push(['-o', args[i].slice(2)]);
    else options.push([args[i]]);
  }
  const host = args[i];
  const remote = args.slice(i + 1).join(' ').trim();
  if (host === undefined) return; // `ssh -V`: no connection
  for (const [flag, value] of options) {
    const fine = flag === '-o' ? SSH_O_VALUES.test(value) : SSH_PLAIN_OPTIONS.has(flag);
    if (!fine) deny(`passes ssh an option outside the few plain ones (${flag}${value ? ` ${value}` : ''})`);
  }
  if (host !== SERVER) deny(`opens ssh to ${host}; the only machine is ${SERVER}, and only in its read-only shapes`);
  if (!(RAW_SSH[S.agent] ?? []).some((re) => re.test(remote))) {
    deny('reaches the server outside the five read-only scripts and the raw read shapes its own file allows');
  }
}

function checkPsql(args, c, ctx) {
  const sqlGiven = args.some((a) => /^(-c|--command)/.test(a)) || c.heredocs.length > 0 || c.pipedIn || c.redirects.some((r) => r.op === '<<<');
  if (!sqlGiven && args.some((a) => /^(-l|--list|-V|--version|--help|-\?)$/.test(a))) return;
  if (args.some((a) => /^(-[a-eg-zA-Z]*f|--file)/.test(a)) || c.redirects.some((r) => r.op === '<')) {
    deny('runs SQL from a file the guard cannot read (SQL goes through data-audit/run.sh, whose session is read-only)');
  }
  // Its own SQL where that can be read; SQL that arrives on a pipe, or psql run inside another
  // program (docker exec ... psql), is somewhere on the line, so the whole line is read.
  const own = [...c.heredocs, ...c.redirects.filter((r) => r.op === '<<<').map((r) => r.target)];
  for (let i = 0; i < args.length; i++) {
    if (/^(-c|--command)$/.test(args[i])) own.push(args[i + 1] ?? '');
    else if (/^(--command=|-c)./.test(args[i])) own.push(args[i].replace(/^(--command=|-c)/, ''));
  }
  const m = SQL_WRITE.exec(c.pipedIn || ctx.embedded ? ctx.full : own.join('\n'));
  if (m) deny(`runs psql in a command that names "${m[0].trim()}", so it may write (SQL goes through data-audit/run.sh, whose session is read-only)`);
}

function checkShell(args, c, ctx) {
  let i = 0;
  let fromStdin = false;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      i++;
      break;
    }
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) return checkText(args[i + 1] ?? '', false, ctx);
    if (/^-[a-zA-Z]*s[a-zA-Z]*$/.test(a)) fromStdin = true;
    if (a === '-o' || a === '-O' || a === '--rcfile' || a === '--init-file') i++;
    else if (!a.startsWith('-') && !a.startsWith('+')) break;
  }
  if (!fromStdin && args[i] !== undefined) return checkScriptFile(args[i]);
  for (const body of c.heredocs) checkText(body, false, ctx);
  for (const r of c.redirects) if (r.op === '<<<') checkText(r.target, false, ctx);
  if (c.pipedIn || c.redirects.some((r) => r.op === '<')) rawScan(ctx.full, 'feeds a shell a script');
}

function checkPowerShell(args, c, ctx) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if (/^[-/]e(c|n|nc|nco|ncod|ncode|ncoded|ncodedc\w*)?$/.test(a)) deny('passes PowerShell an encoded command, which the guard cannot read');
    if (/^[-/]c(o|om|omm|omma|omman|ommand)?$/.test(a)) {
      const text = args.slice(i + 1).join(' ');
      if (text.trim() === '-') break;
      return checkText(text, true, ctx);
    }
    if (/^[-/]f(i|il|ile)?$/.test(a)) return checkScriptFile(args[i + 1]);
    if (/^[-/](executionpolicy|ex|ep|windowstyle|w|workingdirectory|wd|configurationname|outputformat|of|inputformat|if|version|settingsfile)$/.test(a)) i++;
    else if (!/^[-/]/.test(a)) return checkText(args.slice(i).join(' '), true, ctx);
  }
  for (const body of c.heredocs) checkText(body, true, ctx);
  if (c.pipedIn || c.redirects.some((r) => r.op === '<' || r.op === '<<<')) rawScan(ctx.full, 'feeds PowerShell a script');
}

function checkInterpreter(name, w, c, ctx) {
  const args = w.slice(1);
  const inline = /^py/.test(name) ? /^-c$/ : name === 'php' ? /^-r$/ : name === 'perl' || name === 'ruby' ? /^-[a-zA-Z]*e$/ : /^(-e|--eval|-p|--print|-pe)$/;
  let script = false;
  for (let i = 0; i < args.length; i++) {
    if (inline.test(args[i])) return rawScan(args[i + 1] ?? '', `runs ${name} code`);
    if (args[i] === 'eval' && (name === 'deno' || name === 'bun')) return rawScan(args.slice(i + 1).join(' '), `runs ${name} code`);
    if (!args[i].startsWith('-')) {
      script = true;
      break;
    }
  }
  if (!script) {
    for (const body of c.heredocs) rawScan(body, `runs ${name} code`);
    for (const r of c.redirects) if (r.op === '<<<') rawScan(r.target, `runs ${name} code`);
    if (c.pipedIn) rawScan(ctx.full, `feeds ${name} a script`);
    return;
  }
  checkGeneric(w, c, ctx);
}

function checkFind(args, ctx) {
  for (let i = 0; i < args.length; i++) {
    if (/^-(exec|execdir|ok|okdir)$/.test(args[i])) {
      let j = i + 1;
      while (j < args.length && args[j] !== ';' && args[j] !== '+') j++;
      checkSimple(args.slice(i + 1, j), null, ctx);
      i = j;
    } else if (args[i] === '-delete') {
      const starts = [];
      for (const a of args) {
        if (/^[-(!]/.test(a)) break;
        starts.push(a);
      }
      checkRemove('rm', ['-r', ...(starts.length > 0 ? starts : ['.'])], ctx);
    }
  }
}

function checkRemove(name, args, ctx) {
  const windows = ctx.ps || name !== 'rm';
  const recursive = windows
    ? args.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(a) || /^\/s$/i.test(a))
    : args.some((a) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(a) || a === '--recursive');
  const targets = args.filter((a) => !a.startsWith('-') && !/^\/[a-zA-Z]$/.test(a));
  for (const t of targets) {
    checkAnchor(t, ctx); // `rmdir E:/FMIP/ops` takes the junction away; the next `mklink /J` re-points it
    checkShellTarget(t, ctx, 'remove');
    if (!recursive) continue;
    const p = normPath(t, ctx.cwd, true);
    if (p === null || /[$`]/.test(p)) deny(`removes a folder tree the guard cannot place (${t})`);
    for (const q of shellPlaces(t, ctx)) {
      const fixed = q.split('/');
      const wild = fixed.findIndex((seg) => /[*?[\]{}]/.test(seg));
      const tree = (wild < 0 ? fixed : fixed.slice(0, wild)).join('/');
      // A wildcard may empty the agent's own scratchpad, never a whole temp folder.
      // (<temp>/claude holds every session's scratchpad: its children may go, never the folder itself.)
      // The repository first: a checkout that itself lives under the temp folder is still the repository.
      const own = wild >= 0 && S.scratch && tree === S.temps[0];
      if (within(S.repo, tree) || (!own && (!inTemp(tree, S.shellTemps) || S.pool.includes(tree)))) deny(`removes a folder tree outside the scratchpad and temp folders (${t})`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The browser.

function checkUrl(value) {
  const s = String(value ?? '').trim();
  if (s === '' || /^(back|forward)$/i.test(s)) return;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|javascript|file|blob|chrome|view-source):/i.test(s) ? s : `https://${s}`);
  } catch {
    deny(`opens an address the guard cannot read (${s})`);
  }
  if (url.href === 'about:blank') return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') deny(`opens an address that is not a web page (${url.protocol})`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const ours = OUR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const local = LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
  if (ours || local) {
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the raw path
    }
    const first = path.toLowerCase().split(/[/\\]+/).filter(Boolean).slice(0, 3);
    if (first.some((seg) => CLOSED_SEGMENTS.has(seg))) deny('opens the agents console or an admin page');
    return;
  }
  if (OWN_SITE_ONLY.has(S.agent)) deny(`browses a site other than ours (${host})`);
}

// ---------------------------------------------------------------------------------------------

function judge(input) {
  const tool = String(input.tool_name ?? '');
  const a = input.tool_input !== null && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = typeof input.cwd === 'string' ? normPath(input.cwd, null) : null;

  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    return checkFilePath(a.file_path ?? a.notebook_path ?? a.path, cwd);
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(a.command ?? '');
    return checkText(command, tool === 'PowerShell', { cwd, full: command, depth: 0 });
  }
  if (/__(navigate|preview_start)$/.test(tool)) return checkUrl(a.url);
  if (/__browser_batch$/.test(tool) && Array.isArray(a.actions)) {
    for (const step of a.actions) if (/(^|__)(navigate|preview_start)$/.test(String(step?.name ?? ''))) checkUrl(step?.input?.url);
  }
  return undefined;
}

function refuse(agent, why) {
  const text = `Blocked by .claude/hooks/team-guard.mjs: as ${agent}, this call ${why}. Do not work around it: write "blocked by guard" in your report and put the action there as a proposal.\n`;
  process.exitCode = 2;
  process.stderr.write(text, () => process.exit(2));
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Not JSON. Closed for a team agent whose name can still be read, open for everyone else.
    const named = /"agent_type"\s*:\s*"([^"\\]*)"/.exec(raw)?.[1].trim().toLowerCase() ?? '';
    if (TEAM.has(named)) return refuse(named, 'reached the guard as input it could not parse, and it fails closed for a team agent');
    return process.exit(0);
  }
  const agent = typeof input?.agent_type === 'string' ? input.agent_type.trim().toLowerCase() : '';
  if (!TEAM.has(agent)) return process.exit(0);
  try {
    const slash = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
    S.agent = agent;
    S.tmp = slash(tmpdir());
    S.home = slash(homedir());
    // This file is <repository>/.claude/hooks/team-guard.mjs; a worktree's copy answers for the main checkout.
    // Folders are known by their real path (what the file tools are judged by) and as written.
    const real = (p) => realPath(canonPath(p, null) ?? String(p));
    S.repo = real(slash(fileURLToPath(import.meta.url)).replace(/\/\.claude\/hooks\/[^/]+$/, '')).replace(/\/\.claude\/worktrees\/[^/]+$/, '');
    // Since 2026-11-21 E:/FMIP/ops and the main checkout's .claude/agent-memory are junctions into the
    // private ops repository: a path is judged by where it lands, so the roots are known there too (T-1949).
    // A root's real path is trusted for writing only when it is the root itself or its known target:
    // a junction re-pointed elsewhere (E:/, the home folder) widens nothing (T-1951). What may not be
    // written is judged wherever it lands now.
    const memoryAt = `${S.repo}/.claude/agent-memory`;
    const memory = real(memoryAt);
    S.memoryAny = within(S.repo, memory) ? '' : memory;
    S.memory = S.memoryAny === KNOWN_TARGETS.memory ? S.memoryAny : '';
    S.writeRoots = [...new Set(WRITE_ROOTS.flatMap((p) => [p, real(p)].filter((r) => r === p || r === KNOWN_TARGETS[p])))];
    S.findings = [...new Set([FINDINGS, real(FINDINGS)])];
    S.anchors = [...new Set([...WRITE_ROOTS, memoryAt, KNOWN_TARGETS['e:/fmip/ops'], KNOWN_TARGETS.memory])];
    const tmp = normPath(S.tmp, null);
    const realTmp = real(tmp);
    const scratch = typeof input.scratchpad_dir === 'string' && input.scratchpad_dir.trim() !== '' ? normPath(input.scratchpad_dir, null) : null;
    S.scratch = scratch !== null;
    // The scratchpad's and <temp>/claude's real paths count only while they stay in the temp folder
    // (a short name spelled out): a scratchpad removed and made a junction to the home folder is not one.
    const trusted = (p, r) => r === p || within(tmp, r) || within(realTmp, r);
    const both = (list) => [...new Set(list.filter(Boolean).flatMap((p) => [p, real(p)].filter((r) => trusted(p, r))))];
    S.temps = [...(scratch === null ? [] : [scratch]), ...both([scratch, `${tmp}/claude`]).filter((p) => p !== scratch)];
    S.shellTemps = both([...S.temps, tmp]);
    S.pool = both([`${tmp}/claude`]);
    judge(input);
  } catch (error) {
    if (error instanceof Deny) return refuse(agent, error.message);
    return refuse(agent, `made the guard fail (${error?.message ?? error}), and it fails closed for a team agent`);
  }
  return process.exit(0);
});
