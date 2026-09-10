#!/usr/bin/env node
// Runs the model service's Python with the given arguments.
//
// Prefers the project venv (`.venv`, created by `pnpm --filter @fmip/model
// setup`) so that `pnpm test` from the workspace root reaches the right
// interpreter without anyone activating anything. Falls back to `python` on
// PATH, which is what CI uses after installing the package into the runner's
// interpreter. Windows and POSIX venvs put the executable in different places.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, '.venv', 'Scripts', 'python.exe'),
  join(root, '.venv', 'bin', 'python'),
];
const python = candidates.find((candidate) => existsSync(candidate)) ?? 'python';

const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
