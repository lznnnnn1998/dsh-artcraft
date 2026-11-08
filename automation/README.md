# The ArtCraft automation team

Four roles that keep the plugin series honest between releases. A role is a written procedure, not
an agent instance: whoever runs the cycle — the Lead in a DSH session — reads the role file and does
what it says, and every run leaves the same artifacts behind.

## Why

The series ships fourteen craft plugins on one kernel, a preview panel, a skills repository, an npm
release and a registry entry. Each of those can drift independently: the README claims a version
npm does not have, the market index stops linking, a craft publishes a newer CLI, the preview
recipes stop matching a document, the installer breaks on a platform nobody tested that day.
A monthly look is too late; a daily look is cheap if it is mechanical.

## Roles

| Role | File | Question it answers | Changes files? |
|:--|:--|:--|:--|
| **Auditor** | `auditor.md` | Is what we claim true right now? | no — reports only |
| **Evaluator** | `evaluator.md` | Does it actually work, and is it getting worse? | no — reports only |
| **Improver** | `improver.md` | What do we fix today, and does the fix survive? | yes — on a branch |
| **Cleaner** | `cleaner.md` | What has gone stale, and what is safe to drop? | yes — reversible only |

## Cadence

One cycle per day, 09:00 Asia/Shanghai, and only when there is something to do:

- **Auditor and Evaluator run every day.** They are read-only; a quiet day costs minutes.
- **Improver runs when the Auditor or Evaluator left a P0/P1 finding.** It takes the top three.
- **Cleaner runs on Mondays, or when `state.json` reports more than 20 stale artifacts.**

A role's **work window is six hours**. Stop as soon as the role's exit criteria are met; a window is
a ceiling, not a target. If it expires, write the partial report and hand the remaining items to
`state.json`.

## Hard limits

These are not style preferences. A run that breaks one is a failed run.

1. Never rewrite history, never force-push, never delete a branch someone else owns.
2. Never publish to npm. The Lead publishes, after review, with the human's approval, and only at a
   release point (see the push policy below).
2b. **Push in batches.** A daily run commits locally; it does not push. GitHub is written when a
   batch is worth pulling — a P0 fix, several days of accumulated changes, a release — or when the
   human asks. One push per day at most, never one per role per file.
3. Never modify `repos/` — those are read-only upstream checkouts.
4. Never change the user's profile (install, uninstall, config) as a side effect of checking it.
5. Never touch the user's documents; only files this repository produced.
6. Main is written only by the Lead after reviewing a diff. A role works on a branch.
7. Every claim in a report carries the command that produced it.

## Push and release policy

The series is live on npm; every publish is a new version users may install. That makes publishing
a decision, not a step in a checklist.

| Action | When |
|:--|:--|
| Local commit | every run, as today |
| GitHub push | a batch: a P0 fix, ~3+ days of changes, a release, or the human asking. At most once a day |
| npm publish | only at a release point, with the human's explicit go-ahead, after `verify.mjs` and a fresh install |
| version bump | in the same commit as the release decision, never per fix |

An unpushed local commit is not a finding. The state file records the last pushed SHA so a batch
knows what it is carrying.

## Artifacts

```
automation/
  state.json                 # machine-readable continuity between runs
  reports/
    2026-11-09-audit.md      # one file per role per day
    2026-11-09-eval.md
    2026-11-09-improve.md
    2026-11-09-clean.md
```

`state.json` is the handoff: `findings` accumulates what nobody has fixed yet, `recentRuns` is the
last ten runs with their outcome. A finding moves from `open` to `fixed` or `wontfix`, never
silently disappears.

## How a cycle is run

The Lead reads `daily-cycle.md` and follows it: seed the state, run the Auditor and Evaluator (they
are independent and may run in parallel), decide whether the Improver is warranted, run the Cleaner
if it is due, then review every diff and push only what survives review.

A teammate is addressed by name (`artcraft-auditor`, `artcraft-evaluator`, `artcraft-improver`,
`artcraft-cleaner`) and is told to read its role file first. The role file is the source of truth;
the teammate prompt only says which day it is and where the previous state is.

## What a good day looks like

Nothing is claimed that a command did not show, the two read-only reports agree with the tree they
describe, at most three small fixes land on a branch with a passing `verify.mjs`, and the state file
is honest about what was skipped and why.
