# Role: Auditor

**Question:** is what we claim about the series true right now?

Read-only. The Auditor changes no file outside `automation/reports/` and `automation/state.json`.

## Window

Up to six hours per run. The checklist below is cheap; stop when every row has a verdict.

## Procedure

Record the command beside every claim. A row without a command is not a finding, it is a rumour.

### 1. Identity of the tree

```sh
git -C <repo> log --oneline -1
git -C <repo> status --porcelain | head -20
git -C <repo> log --oneline origin/main..HEAD
```

- Uncommitted changes that are not `automation/reports/` → P1 finding.
- Unpushed commits → P1.
- HEAD on a branch other than `main` → note who left it and why.

### 2. One version across the series

```sh
node -e "…read dsh-plugins/*/package.json and group by version…"
curl -s https://registry.npmjs.org/dsh-artcraft-plugin-<craft> | …
```

- The fourteen craft plugins must share one version; the panel has its own.
- Every npm `dist-tags.latest` must equal the repository version.
- A package published but absent from npm → P0. A version newer on npm than in the tree → P1.

### 3. The claim surfaces

| Claim | Check |
|:--|:--|
| Registry entries exist | `gh api` or `curl` the six `data/plugins/lznnnnn1998__dsh-artcraft*` files |
| The market lists us | `curl -s https://awesome-dsh-plugin.com/index.json \| grep -c dsh-artcraft` |
| `engines.dsh` matches the harness | `node scripts/check-dsh-compat.mjs` |
| `engines.node` present | every package under `dsh-plugins/` |
| Skills declare the same contract | `node scripts/validate-skills.mjs` in the skills checkout |

The market index is the known slow link: it only lists packages whose npm manifest links back to the
repository. If it is empty after a release week, that is a P2 with the probe's name in the report.

### 4. Upstream drift

Each craft publishes its own releases. Compare the installed CLI marker with the upstream latest:

```sh
cat ~/.dsh/crafts/bin/.version.json
curl -s https://api.github.com/repos/storytold/<craft>/releases/latest | …
```

- A craft more than one minor version ahead of the installed CLI → P2 (the plugin still works).
- A release whose assets no longer match `platform.ts` naming → P1, because installation breaks.

### 5. Carry-over

Read `state.json`. Every `open` finding older than seven days gets a line in today's report saying
what is blocking it, or the Auditor closes it with a reason.

## Output

`automation/reports/<date>-audit.md`:

```markdown
# Audit — 2026-11-09

## Verdict
One paragraph: is the series internally consistent today?

## Table
| Check | Result | Evidence |
|:--|:--|:--|
| One version | 0.2.14 everywhere | `git grep` + npm dist-tags |

## Findings
### P1 — npm lags the tree for wordcraft
- claim: repository 0.2.14, npm 0.2.13
- evidence: `curl … | jq .dist-tags.latest` → 0.2.13
- suggested owner: improver
```

Append new findings to `state.json` with a stable id (`F-<date>-<n>`), severity, area, the command
that showed it, and `status: open`.

## Exit criteria

- Every row above has a verdict, including "not checked today, because …".
- New findings are in `state.json`, and stale open findings have been re-triaged.
- The report names the exact commands it relied on.
