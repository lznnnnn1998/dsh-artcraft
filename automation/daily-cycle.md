# The daily cycle

The runbook the Lead follows when the daily trigger fires. It exists so that "the team ran" means
the same thing every day.

## Before anything

```sh
git -C <repo> status --porcelain | head
git -C <repo> log --oneline -3
cat automation/state.json
ls automation/reports/ | tail -5
```

If `main` has uncommitted changes that are not `automation/reports/`, stop: the tree is someone
else's work in progress. Report that and run nothing else.

Two paths are deliberately untracked and are not a stop sign: `.github/` (the CI workflows wait for
a token with the `workflow` scope) and the generated `dsh-plugins/preview-panel/{src/index.js,lib/client.js}`
that `check-dsh-compat.mjs` regenerates identically. Anything else untracked is a real gate.

## Decide what runs

- **Auditor and Evaluator:** run every day. Send both at once; they are independent and read-only.
- **Improver:** run when the state has a `P0`/`P1` finding, or when yesterday's Auditor/Evaluator
  escalated one. Three fixes maximum.
- **Cleaner:** run when it is Monday, or when `state.json` counts more than twenty stale artifacts.

A day where the Auditor and Evaluator both come back clean with no open findings is a **skip day**
for the other two. Write a one-line state entry and stop.

## Run them

Each teammate is addressed by name and told the day and where the state is; the role file is the
source of truth:

> You are the Auditor for the ArtCraft series. Today is <date>. Read
> `automation/auditor.md` and follow it. Read `automation/state.json` first. Work window: six hours,
> stop when the exit criteria are met. Do not touch files outside `automation/`.

The Improver runs only after the two read-only reports are in, because it works from their findings.
The Cleaner is independent and may run beside the Auditor.

## Review

A report is a claim; the Lead verifies one command per report before believing the rest:

- re-run the command behind the headline finding;
- for the Evaluator, check the suite exit codes it quotes;
- for the Improver, read the diff (`git diff main...automation/<date>-<slug>`) and run
  `node scripts/verify.mjs` on the branch.

Then decide, per the repository's rule:

| Diff touches | Action |
|:--|:--|
| docs, comments, `automation/` | commit after review and `validate-registry-entries.mjs`; push only with the batch |
| tests, build scripts, kernel or plugin sources | run `verify.mjs` + `build-kit.mjs`, then ask the human before merging |
| versions, npm metadata | human decides; publishing is never automatic |

A finished run ends with a **local commit**, not a push. Pushing is a batch decision: a P0, a few
days of accumulated work, a release, or the human asking. npm is only written at a release point
with explicit approval, after a fresh-install check on a disposable profile.

## Close the day

Update `automation/state.json`:

- `lastRun` = today, `recentRuns` gets `{date, roles, outcome, openFindings}` (keep ten);
- findings the Improver fixed move to `fixed` with the sha and the proving command;
- each verdict is one line in the day's report.

Then tell the human, in five lines or fewer: what was checked, what was found, what was fixed, what
needs a decision, what runs next.

## Escalation

- **P0** (users cannot install, render or release): tell the human the same day, even if the window
  is not over.
- **Blocked on a decision**: write the options and the recommendation into `state.json` as a
  `decision` finding; do not guess.
- **Window exhausted**: partial report plus a state entry naming what was left.
