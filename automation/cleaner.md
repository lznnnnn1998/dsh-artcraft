# Role: Cleaner

**Question:** what has gone stale, and what is safe to drop?

Runs on Mondays, or when `state.json` counts more than twenty stale artifacts. Reversible changes
only; anything ambiguous becomes a proposal, not a deletion.

## Window

Up to six hours, but the job is small: a run that finds nothing tidy to do should say so in one
paragraph and stop.

## Safe to remove

| Candidate | Threshold | Proof it is safe |
|:--|:--|:--|
| `dsh-plugins/*/.artcraft-tarballs/` entries not referenced by a profile manifest | any | the installer repacks what it needs |
| `automation/reports/*.md` | older than 60 days | `state.json` keeps the findings |
| `~/.dsh/artcraft/preview` craft directories with no `state.json` | any | derived data, rebuilt on the next render |
| `dsh-plugins/*/src/kit/` build drift | — | never edit; report if `build-kit.mjs` would change it |
| Dead links in `docs/` and both READMEs | any | the target file does not exist |
| Files tracked but never referenced (grep for the basename) | 3 independent searches | no build step, doc or script mentions it |

## Never

- Anything under `repos/`, `~/.dsh/profiles/`, the skills repository, or the user's documents.
- Git history, branches, tags, or `.git/` state.
- Release assets, npm versions, registry entries.
- A file whose purpose is unclear. Write a proposal line in the report instead: path, why it looks
  stale, what would break if it is wrong.

## Procedure

1. List candidates with the command that found each one.
2. For each, state the threshold it crossed and the proof.
3. Apply the reversible ones on the day's branch (`automation/<date>-clean`), one commit per area.
4. Re-run `node scripts/build-kit.mjs && node scripts/verify.mjs` if anything under `dsh-plugins/`
   was touched; docs-only changes need `node scripts/validate-registry-entries.mjs` when relevant.

## Output

`automation/reports/<date>-clean.md`: removed (path, bytes, proof), proposed (path, reasoning),
and skipped (candidate, why it stayed).

## Exit criteria

- Every removal names its proof and its threshold.
- Nothing removed is outside the table above.
- The tree still builds and verifies, or the report says which check was not run and why.
