# Role: Evaluator

**Question:** does the series actually work today, and is anything worse than yesterday?

Read-only. It runs the suites the project already ships and scores the result; it does not fix.

## Window

Up to six hours. The suites take minutes; use the rest for the cross-platform sweep and a fresh
install when one is warranted.

## Procedure

### 1. The suites

```sh
node scripts/verify.mjs            # every craft: real CLI action + preview image
node scripts/check-dsh-compat.mjs  # engines.dsh against the harness in this checkout
node scripts/doctor.mjs            # profiles, CLIs, package versions, companions
node scripts/validate-registry-entries.mjs
```

Record exit code, wall time, and the tail of each output. A non-zero exit is P0 and goes to the
report before anything else.

### 2. Preview coverage

```sh
node -e "…CRAFT_PROFILES.filter(p => canPreview(p)).map(p => p.id)…"
```

The expected set is thirteen of fourteen; SoundCraft has no image verb. A craft that used to render
and stopped → P1.

### 3. Fresh install (weekly, or after any installer change)

In a temporary directory, from a clean clone of the published repository:

```sh
git clone <published repo> /tmp/eval-<date>
node /tmp/eval-<date>/scripts/install-craft.mjs
node /tmp/eval-<date>/scripts/install-into-profile.mjs --profile <disposable> --dsh-home /tmp/eval-dsh
```

- Fifteen bundles install; all fifteen `import()` and export `apply`.
- The preview server answers `/state` on the configured port.
- Then `--uninstall` leaves no packages behind.

Never run this against the user's real profile.

### 4. Cross-platform sweep (static)

The repository must not regress on Windows or Linux:

```sh
git grep -nE "/Users/|/opt/homebrew" -- . ':!repos'
git grep -n "path.posix"
git grep -n "spawn(" -- '*.ts' '*.mjs'   # every spawn should carry windowsHide
git grep -n "chmodSync"                  # each call guarded by isWindows
```

- A machine-specific path in the tree → P1.
- A spawn without `windowsHide` → P2.
- `chmodSync` outside an `isWindows` guard → P2.

### 5. Score

Five dimensions, 1–5, with the same rubric every day so the trend means something:

| Dimension | 5 means |
|:--|:--|
| Correctness | verify.mjs green, no known P0 |
| Coverage | every craft renders that can; every documented path exercised |
| Documentation | README/INSTALL match what the scripts do |
| Portability | no machine paths, Windows rules respected |
| Release hygiene | npm, registry and tree agree |

Compare with the previous run in `state.json`; a drop of 2 in any dimension is itself a finding.

## Output

`automation/reports/<date>-eval.md`: suite table (command, exit, time, tail), coverage, fresh-install
result, sweep hits, the score table with the delta, and findings with evidence.

## Exit criteria

- Every command above either ran (with its result recorded) or is listed as skipped with the reason.
- Scores are in the report and in `state.json`.
- Regressions are P0/P1 findings, not prose.
