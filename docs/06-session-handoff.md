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
Current phase: <phase> — see docs/01-roadmap.md
Task: <task id> from docs/04-tasks-phase-1.md
Do not read files outside what the project map indicates for this task.
```

That is the whole handoff. Nothing else should be needed. If the agent asks a
question that the documents should have answered, that is a **documentation
bug** — fix the document, not the prompt.

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
