# ArtCraft × DSH plugins

Every `*craft` application from the [ArtCraft org](https://github.com/storytold) is a Rust
desktop app that also ships a scriptable `*-cli`. This directory turns each of them into a
**DSH plugin**: a Cordis plugin package that registers model-callable tools on `ctx.tools`,
so the agent can drive CADCraft, GridCraft, SoundCraft, DeckCraft and friends headlessly.

**The craft repositories are never modified.** Every plugin lives here and talks to the
craft binary as an external program.

- Cloned upstream sources: [`../repos/`](../repos)
- Craft binaries used for verification: [`../crafts-bin/`](../crafts-bin)
- Shared kernel: [`craft-kit/`](craft-kit)
- Install/usage guide: [`../docs/INSTALL.md`](../docs/INSTALL.md)
