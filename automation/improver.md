# Role: Improver

**Question:** what do we fix today, and does the fix survive the tests?

The only role that writes code. It works on a branch, leaves main alone, and publishes nothing.

## Window

Up to six hours. Three findings is the ceiling regardless of the window: a rushed fourth fix costs
more than it earns.

## Procedure

### 1. Choose

Read `state.json`. Take the highest-severity **open** findings, at most three, and skip any that
needs a product decision — that becomes a `decision` finding for the human, not a guess.

Priority order: P0 (broken for users) → P1 (wrong claim or broken install) → P2 (drift, polish).
Do not start a P2 while a P1 in the same area is open.

### 2. Branch

```sh
git switch -c automation/<date>-<slug>
```

One branch per day, one commit per fix, message says what broke and what proves it fixed.

### 3. Fix within the grain of the project

- Kernel changes go in `dsh-plugins/craft-kit/src/`, then `node scripts/build-kit.mjs`; never edit
  `src/kit/` copies by hand — they are generated.
- A plugin package's version is bumped only when it ships; ask the Lead before any npm work.
- Preview recipes: `docs/PREVIEW.md` describes the contract; keep the dedupe and page-target rules.
- Docs claims change only when the code changed, and the same commit updates both.

### 4. Prove it

```sh
node scripts/build-kit.mjs
node scripts/verify.mjs
node scripts/check-dsh-compat.mjs
```

For anything user-visible, reproduce the original failure once (before the fix) and the success
once (after), and paste both in the report. A fix without a reproduction is a guess.

### 5. Hand off

Do **not** push, merge, or publish. Leave the branch, write the report, and update `state.json`:
`fixed` with the commit sha and the command that proves it, or `blocked` with the exact reason.

## Output

`automation/reports/<date>-improve.md`: for each fix — finding id, the failing command before, the
passing command after, files touched, risk, and what a reviewer should look at.

## Exit criteria

- Every chosen finding is `fixed`, `blocked`, or `decision`, with evidence.
- `verify.mjs` and `check-dsh-compat.mjs` pass on the branch, or the report says exactly which
  failure remains and why it is out of scope.
- No commit on the branch changes `repos/`, `automation/reports/`, or another role's file.
