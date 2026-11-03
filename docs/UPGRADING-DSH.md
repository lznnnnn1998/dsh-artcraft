# Upgrading DSH

Two of the three layers a user can install reach into the harness; one does not. The difference
decides what to check before an upgrade.

| Layer | What it uses | Coupling |
|---|---|---|
| The fourteen craft plugins | `ctx.tools.register`, `ctx.systemPrompt.section`, `ctx.inject`, `ctx.get`, `dsh.bundle.patch` | Documented plugin surfaces. Low risk. |
| The preview panel (`dsh-artcraft-preview-panel`) | the `dsh.client` scan, the `/plugins/…` route, the `__ModuleLoader__` closure wire, the `main` and `sidebar.panellist` slots, the host React module table | **Non-public internals.** A renamed slot or a changed wire can fail the Web boot audit. |
| The local panel (`scripts/preview/`) | nothing but HTTP and a browser | None. |

## The version guard

Every package declares the runtime it was verified against:

```json
"engines": { "dsh": "^0.2.1-rc.3" }
```

DSH's app-boot evaluates that before loading a bundle and **throws** when it is unmet, naming the
plugin and the remedy (`dsh plugin allow-version`). A range that is too narrow is therefore a loud,
recoverable failure rather than a silent misbehaviour — which is what an upgrade should produce.

`^0.2.1-rc.3` accepts every `0.2.x` and refuses `0.3.0`: the current internals are a 0.2 contract.

## The sentinel

Run this after upgrading DSH, and in any CI that builds against a new harness:

```sh
node scripts/check-dsh-compat.mjs
```

It reports the harness version it found, checks every package's `engines.dsh` against it, and
rebuilds plus verifies the preview panel — the one component whose breakage would be visible as a
broken Web UI rather than a failed tool call.

## If it fails

1. **A craft plugin's range is unmet.** Either the new DSH is outside the range (raise it after
   checking the release notes) or the plugin really is incompatible (fix it before publishing).
2. **The panel's verify fails.** The harness changed a client internal. Read the failing check:
   manifest, export, bundle registration, slot registration, or type-check. The panel is optional —
   remove it from `dsh.profile.bundles` to restore the Web UI, then port it to the new contract.
3. **Nothing to fix, but the range blocks you.** `dsh plugin allow-version` grants an exact-version
   exemption; it is a deliberate, recorded acceptance of the risk, not a configuration shortcut.

## What CI covers

`.github/workflows/ci.yml` runs the parts that need no applications installed: the generated kernel
is current, the registry entries parse and follow the submission rules, and the preview panel
builds and verifies against a freshly cloned harness. The full `scripts/verify.mjs` needs the
fourteen CLIs and is a local step, not a CI one.
