# Session handoff

**Problem this solves.** Chats get long and expensive. Starting a fresh one must
cost almost nothing in lost context and must not risk the agent re-deciding
something that was already settled.

**Principle.** The repository is the memory. The chat is disposable. If something
matters and lives only in a chat, it is already lost.

---

## Starting a new session

Paste this into a fresh Claude Code session:

```
Project: FMIP (Football Match Intelligence Platform).
Read CLAUDE.md and docs/03-project-map.md first.
Then read "Environment constraints" in docs/06-session-handoff.md — it will
save you from re-discovering two network limits the hard way.
Current phase: <phase> — see docs/01-roadmap.md
Task: <task id> from docs/04-tasks-phase-1.md
Do not read files outside what the project map indicates for this task.
```

That is the whole handoff. Nothing else should be needed. If the agent asks a
question that the documents should have answered, that is a **documentation
bug** — fix the document, not the prompt.

**Where the current state lives.** Nowhere in this file. Task status is in
`docs/04-tasks-phase-1.md`, including a note under each epic table for any task
that is `[~]` and what remains. Decisions are in `docs/00-decisions.md`. This
file deliberately holds neither, because a second copy of a status is a copy
that goes stale.

---

## Environment constraints

Two hard limits shape how work gets verified here. Both were found by hitting
them, and neither is guessable from the code.

### 1. The agent sandbox cannot build container images

Claude Code's environment blocks Docker Hub's layer CDN
(`production.cloudfront.docker.com` returns `403`). The registry API is
reachable, so image *tags* can be confirmed to exist, but no image can be
pulled and therefore none can be built.

**Consequence.** An agent can never run `docker compose up`. Anything whose
acceptance criterion needs a running container is verified by the maintainer,
not by the agent. T-002, T-004 and T-009 were closed by exactly one such run on
the maintainer's machine, and any future container-dependent task needs the
same. An agent picking up such a task should write the configuration, verify
everything reachable without a container — `docker compose config`, running the
built server directly — and say plainly what it could not check, rather than
implying the stack was seen working.

A native PostgreSQL can be installed with `apt-get install postgresql`, which is
how T-008's migrations were actually verified. Prefer that over declaring a
database task unverifiable.

**Emulating an image build.** A Dockerfile's stages can be run without a
daemon: copy exactly the files each `COPY` names into a scratch directory, run
the same `RUN` commands there, and start the result the way its `CMD` would.
The `deps` stage deserves the most care — copy only the manifests it lists, so
that a workspace package the Dockerfile forgot is missing there too. This is
what caught the `apps/api` Dockerfile that T-006 had silently broken: it was
written before `apps/api` depended on `@fmip/contracts`, and nothing built the
image afterwards. A Dockerfile is the one build that CI never runs, so re-run
the emulation whenever a workspace dependency is added to an app.

### 2. The maintainer's machine cannot reach the npm registry

Development is on **Windows**. From that host, `registry.npmjs.org` and
`registry.npmmirror.com` both time out at the TCP level — not a DNS failure, and
changing the resolver to `1.1.1.1` does not help. `nodejs.org` is unreachable
too, so `nvm install` fails.

What *does* work from that host: **Docker Hub**, and **the network inside a
container**. This is confirmed:

```
docker run --rm node:22-alpine npm view pnpm version
12.3.4
```

**Consequence.** Unproxied, `pnpm install` cannot run on the Windows host, but
it runs inside an image build, which is where `docker compose build` performs
it. Since 2026-09-10 the host path works too: `bash scripts/dev-proxy.sh` runs
a squid forward proxy in a container, published on `127.0.0.1:3128`, and the
user `~/.npmrc` on the maintainer's machine routes pnpm through it
(`proxy=` and `https-proxy=`). With that in place `pnpm install`, `pnpm lint`,
`pnpm typecheck`, `pnpm test` and `pnpm format:check` all run natively on the
host, which is how an agent verifies the definition of done locally instead of
waiting for CI. The proxy container restarts with Docker; check it with
`bash scripts/dev-proxy.sh status`. Corepack and Playwright's browser download
honour the same `HTTPS_PROXY=http://127.0.0.1:3128` if they are ever needed.

It is not perfectly reliable, though. `registry.npmjs.org` resolves to several
Cloudflare addresses and, from inside a container on that host, some of them
connect and some time out (`104.16.2.34` failed with `UND_ERR_CONNECT_TIMEOUT`
in Corepack's pnpm download; `104.16.5.34` and `104.16.8.34` answered minutes
later, from the same build environment and the same DNS). Requests that do get
through can take 10–25 s. When a build dies on a connect timeout to the
registry, the remedy is to run `docker compose build` again, not to change a
Dockerfile: the pnpm store is a cache mount and survives the retry.

Node 24 is installed there and satisfies `engines` (`>=22.0.0`); CI runs Node 22
per `.nvmrc`. The difference is accepted rather than fixed, because installing
Node 22 requires `nodejs.org`.

### 3. Python on the maintainer's machine

Python 3.12 and 3.14 are installed; `python` on PATH is 3.14. `apps/model` uses
a plain venv: `pnpm --filter @fmip/model setup` creates `.venv` and installs the
package with its dev tools. pip needs the same proxy as pnpm:
`python -m pip install --proxy http://127.0.0.1:3128 -e "apps/model[dev]"`.
The Turbo scripts find the venv through `scripts/py.mjs`, so `pnpm test` from
the root covers the Python tests without activating anything.

Two traps. **psycopg and `localhost`:** on this host a connection string with
`localhost` takes about 130 seconds to connect (IPv6 `::1` is tried first and
times out); `127.0.0.1` connects in 30 ms. `.env.example` says `127.0.0.1` for
that reason; keep it. **`python -` with a heredoc through the Bash tool
hangs:** write a temporary file and run it instead.

Club Elo's API (`api.clubelo.com`) answered `502 Bad Gateway` for the whole of
2026-09-10, directly and through the proxy, while the site itself was up. The
loader records such an attempt as a failed load; re-run it when the API is
back. football-data.co.uk is reachable directly.

### What this means for writing scripts

The rule itself is in `README.md` under Local development: package scripts use
no shell-specific syntax. Here is why it is there.

pnpm runs package scripts through `cmd.exe` on Windows, where `${VAR:-default}`
is a literal string and `&` sequences instead of backgrounding. Both are
silently wrong rather than loudly broken, and both shipped once. The
`${WEB_PORT:-3000}` one made the RTL check from T-007 impossible to run on the
only machine that could run it — a check nobody could execute is worse than no
check, because it looks like coverage.

---

## Ending a session

Before closing a long chat, make sure each of these is true:

- [ ] Any decision reached is written into `docs/00-decisions.md`.
- [ ] Any file added or responsibility moved is reflected in `docs/03-project-map.md`.
- [ ] Task checkboxes in `docs/04-tasks-phase-1.md` match reality.
- [ ] Work in progress is pushed to a branch, even if incomplete, with a note in
      the PR description about where it stopped.
- [ ] Anything learned that changes future work has a home in a document.

If all five hold, the chat can be closed without reading it again.

---

## Verifying the handoff actually works

Periodically, test it rather than assuming it:

1. Open a **fresh** chat with no history.
2. Give it only the handoff prompt above and access to the repository.
3. Ask it: *"What is this project, what phase are we in, what are the locked
   architectural decisions, and what should be worked on next?"*
4. Compare the answer against reality.

Anything it gets wrong or has to guess at is a gap in the documents. Fix the
gap. This test is cheap and catches drift long before it becomes expensive.

Run it after every phase boundary, and any time the documents have changed a lot.

---

## Which surface for which work

| Work | Use | Why |
|---|---|---|
| Discovery, decisions, architecture debate | Chat, inside a Project | Text-heavy, cheap, needs conversation |
| Deep comparison research | Chat with Research | Multi-source, produces a document |
| Writing and changing code | Claude Code on the web | Runs on cloud infrastructure, produces a PR, no local setup |
| Long multi-step non-code work | Cowork | Runs unattended |
| Visual direction, UI concepts | Claude Design | Iterate on a canvas |
| Quick interactive prototype of one screen | Artifacts | See it before committing to real code |

Keep research and coding in **separate** sessions. Mixing them inflates context
for no benefit.

---

## Cost discipline

The usage budget is shared across chat, Claude Code and Cowork, metered as a
rolling session window plus a weekly cap. Check Settings → Usage for the live
figures; treat that screen as the source of truth.

Practices that matter most, in order of impact:

1. Decide in chat, execute in Claude Code. Exploration by an agent is expensive;
   a precise task specification is cheap.
2. Keep `03-project-map.md` accurate so no repository scan is ever needed.
3. Write tests, so failures are caught by CI rather than by a human round-trip.
4. Keep tasks small enough that one PR is one coherent change.
5. Never paste large files into chat when a path will do.
