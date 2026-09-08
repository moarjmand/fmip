#!/usr/bin/env bash
# FMIP — repository bootstrap
#
# Windows: right-click inside this folder -> "Open Git Bash here", then run:
#     bash setup-repo.sh
#
# Nothing to edit. The script asks for what it needs.

set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight -------------------------------------------------------------

command -v git >/dev/null 2>&1 || fail "git is not installed or not on PATH."

[ -f "CLAUDE.md" ] && [ -d "docs" ] \
  || fail "Run this from the folder containing CLAUDE.md and docs/. You are in: $(pwd)"

[ -d ".git" ] && fail "This folder is already a git repository. Nothing to do."

# --- input -----------------------------------------------------------------

say "FMIP repository setup"

read -rp "GitHub username: " GITHUB_USER
[ -n "$GITHUB_USER" ] || fail "Username cannot be empty."

read -rp "Repository name [fmip]: " REPO_NAME
REPO_NAME="${REPO_NAME:-fmip}"

read -rp "Your name (for commit history): " GIT_NAME
read -rp "Your email (for commit history): " GIT_EMAIL
[ -n "$GIT_NAME" ] && [ -n "$GIT_EMAIL" ] || fail "Name and email are required by git."

printf '\nAbout to push to: https://github.com/%s/%s\n' "$GITHUB_USER" "$REPO_NAME"
printf 'That repository must already exist on GitHub and be EMPTY.\n'
read -rp "Continue? [y/N] " CONFIRM
case "$CONFIRM" in [yY]*) ;; *) echo "Cancelled."; exit 0 ;; esac

# --- generated files -------------------------------------------------------

say "Writing .gitignore"
cat > .gitignore <<'GITIGNORE'
node_modules/
.pnpm-store/
dist/
build/
.next/
.turbo/
coverage/
*.tsbuildinfo

.env
.env.*
!.env.example

__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
.ruff_cache/

.DS_Store
Thumbs.db
.idea/
.vscode/

*.log
tmp/
GITIGNORE

say "Writing .env.example"
cat > .env.example <<'ENVEXAMPLE'
# Copy to .env and fill in. Never commit .env.
# Every variable added here must also be listed in docs/03-project-map.md.

NODE_ENV=development

# --- Database ---
POSTGRES_USER=fmip
POSTGRES_PASSWORD=change_me_locally
POSTGRES_DB=fmip
DATABASE_URL=postgresql://fmip:change_me_locally@localhost:5432/fmip

# --- Cache / queues ---
REDIS_URL=redis://localhost:6379

# --- Services ---
API_PORT=3001
WEB_PORT=3000
MODEL_SERVICE_URL=http://localhost:8000

# --- Auth ---
SESSION_SECRET=generate_a_long_random_string

# --- Data providers: free tiers, for the bake-off (docs/05-data-providers.md) ---
API_FOOTBALL_KEY=
FOOTBALL_DATA_ORG_KEY=
HIGHLIGHTLY_KEY=
ENVEXAMPLE

# --- repository ------------------------------------------------------------

say "Initialising repository"
git init -q -b main
git config user.name  "$GIT_NAME"
git config user.email "$GIT_EMAIL"
git config core.autocrlf false     # .gitattributes handles line endings

git add -A
git commit -q -m "docs: project charter, architecture, decisions and phase 1 backlog"

say "Connecting to GitHub"
git remote add origin "https://github.com/${GITHUB_USER}/${REPO_NAME}.git"

say "Pushing"
printf 'A browser window may open to authorise GitHub. That is expected.\n\n'

if git push -u origin main; then
  cat <<EOF

──────────────────────────────────────────────────────────────
  Done.

  Repository:  https://github.com/${GITHUB_USER}/${REPO_NAME}

  Next:
    1. Open claude.ai/code and connect this repository.
    2. Send this as the first task:

         Read CLAUDE.md and docs/03-project-map.md.
         Then do T-001 from docs/04-tasks-phase-1.md.
──────────────────────────────────────────────────────────────

EOF
else
  cat <<EOF

Push failed. The usual causes:

  * The repository does not exist yet on GitHub.
      -> Create it at https://github.com/new  (private, no README, no .gitignore)

  * The repository is not empty.
      -> Delete and recreate it empty, or push to a different name.

  * Authentication was refused.
      -> GitHub does not accept account passwords. Either let the browser
         prompt complete, or create a Personal Access Token at
         https://github.com/settings/tokens and use it as the password.

  Your local commit is safe. After fixing the cause, run:
      git push -u origin main

EOF
  exit 1
fi
