# Registry submission (awesome-dsh-plugin)

`entries/` holds one ready-to-submit file per craft plugin for the curated
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
registry, which dshmarket.com and the in-app market read.

## Why the first attempt was closed

[PR #7314](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/7314) submitted the
**repository root** as one entry. A maintainer closed it because the root is a pure
aggregation bundle — rule 7 in `contributing.md`: its `cordis.patch.yml` only inserts the
twelve subpackage rows and it ships no behaviour of its own, so it is not listed. The rule is
"list the plugins, not the bundle".

The good news the same comment gives: **each of the twelve subpackages carries its own
`dsh.bundle` and installs independently**, so each qualifies as its own entry.

## The correct entry shape

A monorepo subpackage entry points `url` at the subdirectory and uses
`owner/repo#label` as `name`:

```yaml
url: https://github.com/lznnnnn1998/dsh-artcraft/tree/main/dsh-plugins/plugin-gridcraft
name: lznnnnn1998/dsh-artcraft#plugin-gridcraft
category: tools
description:
  en: ...
  zh: ...
```

The filename is `owner__repo--<subpath with / replaced by ->.yml`, which is why these files
are named `lznnnnn1998__dsh-artcraft--dsh-plugins-plugin-<craft>.yml`.

## Submission rules that shape the plan

- **At most 3 entries per pull request.** Checked first, before anything is fetched.
- **"Split *and* pick"** — send what you would keep if you could only keep a few, not
  everything that works. Batching more than one PR is expected; dumping all twelve in one go
  is not.
- **The 1-day repo-age bar** is met (the repository was created 2026-10-12).
- `dsh.bundle` is resolved by walking the repository's manifests, so the `dsh-plugins/`
  directory name is fine — the `packages/` · `plugins/` · `apps/` names in the docs are
  examples, not a whitelist.

## Suggested batches

Start with the three most distinct and broadly useful, then follow up once they land:

| Batch | Crafts | Rationale |
|---|---|---|
| 1 | gridcraft, cadcraft, soundcraft | spreadsheets, CAD and a DAW: three clearly different applications |
| 2 | wordcraft, photocraft, vectorcraft | documents, raster and vector editing |
| 3 | deckcraft, pdfcraft, designcraft | slides, PDF and page layout |
| 4 | filmcraft, effectcraft, lightcraft | video, motion graphics and photo raw |

Submitting batch 1 alone first is also reasonable: it tests the acceptance bar with the
strongest entries before spending reviewer time on the rest.

## How to submit

For each file, create it at `data/plugins/<filename>` in the registry repository. Opening the
"new file" page on the upstream repository auto-proposes a fork and pull request:

<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/new/main/data/plugins>

Paste the file's contents, name the file exactly as above, choose
**Create a new branch for this commit and start a pull request**, and open the PR. For a batch,
do all three files in one commit so they form a single PR.

Check the result against the rules before opening: `url` matches the repository and
subdirectory, `name` names the same repository, `category` is from the valid list, and both
descriptions state what the plugin does with no superlatives.

## Local validation

The files in this directory were checked for: URL shape, the subdirectory actually existing,
that subdirectory declaring `dsh.bundle`, the filename convention, the `name` pointing at the
same repository, a valid `category`, and both descriptions being present.
