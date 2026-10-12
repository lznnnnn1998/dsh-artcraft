# ArtCraft (umbrella app) — investigation notes

Investigated 2026-10-13 in `repos/artcraft` (the umbrella ArtCraft desktop app) and
`repos/artcraftx` (the pared-down sibling), plus the checked-out `repos/artcraft-services`
and the local `crafts-bin/` inventory.

**Verdict: there is no craft profile to add.** ArtCraft does not ship a scriptable local
CLI, a headless run mode, or a local control channel. Everything below is either
**verified** with file/line or command evidence, or explicitly marked
**not available** / **not verified**. No kernel file was edited.

## Verdict at a glance

| Surface                                              | Status                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Local `*-cli` binary (`crafts-bin/artcraft-cli`)     | **Not available** — not in `crafts-bin/`, no CLI crate      |
| Headless run / command catalog in the app            | **Not available** — both front ends are GUIs                |
| Local control channel (socket/HTTP port in the app)  | **Not available** — none found                              |
| MCP tool server (local)                              | **Not available** — not in either checked-out repo          |
| MCP *session* endpoints on the hosted API            | **Verified** (service-side, credential lifecycle only)      |
| MCP integration in the desktop UI                    | **Not available** — documented as a stub / "not ready"      |
| Programmatic API (hosted HTTP, API key)              | **Verified** — Omni API, not a local craft CLI              |
| UI screenshot automation                             | **Verified** — env-var diagnostics for CI, still a GUI      |

## What I searched

- `repos/artcraft`: `README.md`, `AGENTS.md`, `Cargo.toml`, every `Cargo.toml` in the
  workspace, `artcraft-native/` (all of `src/`), `crates/` (desktop, api_clients, lib,
  schema, testing, vendor), `frontend/` (libs + app), `script/`, `docs/`, `_docs/`,
  `_database/`, `.github/workflows/`.
- `repos/artcraftx`: `README.md`, `CLAUDE.md`, root `Cargo.toml`, `crates/**/Cargo.toml`,
  layout, and GitHub releases.
- `repos/artcraft-services`: route and endpoint modules (MCP-related only).
- Content searches over `repos/artcraft`: `mcp`/`model context protocol` (37 hits),
  `env::args`, `fn main(`, `TcpListener|axum::serve|warp::serve|hyper::Server|tonic::transport|bind(|control_channel`,
  `UnixListener|UnixStream|stdio|headless|--port`, `ARTCRAFT_[A-Z_]+`, `clap`.
- Local: `ls crafts-bin/ | grep -i artcraft` (no match), and the GitHub releases API.

## Verified findings

### 1. No CLI crate and no CLI release asset

- The workspace has no CLI member: `repos/artcraft/Cargo.toml:5-45` lists 39 members
  (native app, api clients, libs, schemas, testing, a vendored Tauri HTTP plugin); the only
  binaries are the two GUI apps. `default-members = ["crates/desktop/artcraft"]`
  (`Cargo.toml:46`).
- No argument parser anywhere: grepping `clap` across `repos/artcraft`'s manifests returns
  nothing.
- `crafts-bin/` contains 12 craft CLIs (`cadcraft-cli` … `wordcraft-cli`); `grep -i artcraft`
  matches **none** of them.
- By contrast, the sibling crafts ship a CLI app crate with the full surface, e.g.
  `repos/soundcraft/apps/soundcraft-cli/Cargo.toml:9-11` declares `[[bin]] soundcraft-cli`
  and its description is *"SoundCraft command line: headless editing, conversion, bounce,
  MCP server, app control"*. ArtCraft has no equivalent `apps/` directory at all.
- The checked-in release workflow publishes only the Tauri bundle:
  `.github/workflows/artcraft-macos-publish.yml:218` uses `tauri-apps/tauri-action@v0` with
  `projectPath: ./crates/desktop/artcraft` (`:231`) and `tagName: artcraft-v__VERSION__`
  (`:232`).
- The published releases confirm it. `GET https://api.github.com/repos/storytold/artcraft/releases?per_page=5`
  (HTTP 200) returned v0.41.0, v0.37.0, v0.32.0, v0.29.0, v0.28.0 — every asset is a desktop
  installer: `ArtCraft_0.41.0_universal.dmg`, `ArtCraft_0.41.0_x64-setup.exe`,
  `ArtCraft_0.41.0_x64_en-US.msi`, `ArtCraft_universal.app.tar.gz`. **No CLI asset in any of
  the five releases.**

### 2. Both front ends are GUI-only

- `artcraft-native` (pure-Rust egui app): `[[bin]] name = "artcraft-native"` at
  `artcraft-native/Cargo.toml:8-10`, `eframe` dependency at `:27`. Its entire entry point is
  `artcraft-native/src/main.rs:18-28` — `fn main() -> eframe::Result`, which calls
  `eframe::run_native(...)`. It never reads `argv`; the only env vars it consults are UI
  diagnostics (see §5). `artcraft-native/README.md:3-5`: *"There is no Tauri and no
  JavaScript; the only webview is the Midjourney sign-in window."*
- Tauri app: `crates/desktop/artcraft/Cargo.toml:17-19` is a `[lib]`
  (`staticlib, cdylib, rlib`); `crates/desktop/artcraft/src/main.rs:4-6` is six lines that
  call `artcraft_app_lib::run()`. `lib.rs:98` `pub fn run()`, `:157` `tauri::Builder`,
  `:227` `invoke_handler`.

### 3. No local control channel

- No HTTP/socket server in the app: a repo-wide search for
  `TcpListener|axum::serve|warp::serve|hyper::Server|tonic::transport` matched only SQLx
  `push_bind` calls and **test-only** localhost listeners
  (`crates/desktop/artcraft/src/services/storyteller/commands/storyteller_login_bridge_tests.rs:339`,
  `crates/desktop/artcraft/src/core/utils/auto_download.rs:235,293`,
  `crates/api_clients/fal_client/src/requests/core_api/fal_request.rs:429`).
  `UnixListener|UnixStream|stdio|--port` matched nothing in `artcraft-native`; the word
  `headless` appears there only in test-module prose about driving widgets with
  `egui_kittest` (`artcraft-native/src/prompt_box/ui_tests.rs:1`,
  `prompt_box/model_selector.rs:215`, `pages/create_audio.rs:821`) plus the screenshot
  comment quoted in §5.
- The app's own IPC is Tauri's in-webview channel: 67 `#[tauri::command]` functions,
  registered through `invoke_handler` at `crates/desktop/artcraft/src/lib.rs:227`. That is
  reachable only from the app's own webview, not from another process, and there is no
  documented protocol for it.
- The only listening ports in the repo belong to dev tooling, not the shipped app:
  `crates/desktop/artcraft/tauri.conf.json:7-10` (`frontendDist`, `devUrl
  http://localhost:5173`, `beforeDevCommand nx run artcraft:dev`), and
  `script/artcraft/unix_frontend_dev.sh:17-30` which frees port 5173 and runs `nx dev
  artcraft`.

### 4. MCP: what actually exists (three different things)

1. **Desktop-side API types for MCP sessions** — ArtCraft's *hosted service* lets an MCP
   client authenticate:
   - `crates/schema/public/enums/src/common/platform_type.rs:32-33` defines
     `PlatformType::Mcp` (*"Requests authenticated via an `Authorization` header MCP session
     credential"*), serialized as `"mcp"` (`:52`).
   - `crates/schema/public/tokens/src/prefixes.rs:41-42` defines `McpSessionPrivate` and
     `McpSessionRefresh` token prefixes.
   - `crates/api_clients/artcraft/artcraft_api_defs/src/mcp_sessions/` holds the request /
     response types for `create`, `list`, `refresh`, `revoke` and `delete`
     (e.g. `create_mcp_session.rs:7` `POST /v1/mcp/session/create`; `common.rs:38`
     `POST /v1/mcp/session/{token}/delete`).
2. **Service-side session lifecycle endpoints** — in the sibling repo
   `repos/artcraft-services`: routes at
   `crates/service/web/storyteller_web/src/http_server/routes/application_routes/mcp_session_routes.rs:24`
   (`web::scope("/v1/mcp/session")`), wired at `add_application_routes.rs:69`, with handlers
   under `.../http_server/endpoints/mcp_sessions/` for `/create` (`:28`), `/list` (`:29`),
   `/refresh` (`:30`), `/revoke` (`:23`) and `/{token}/delete` (`:28`).
   **These mint credentials; they are not an MCP tool server.** A search for an actual MCP
   server implementation (`rmcp`, `mcp_server`, `McpServer`) across `artcraft-services`
   found nothing — so the `tools/list` / `tools/call` side lives outside the checked-out
   code, and nothing in this workspace can drive it.
3. **Desktop UI integration is a stub** — documented in
   `frontend/libs/components/pagescene/AGENTS.md`: `:96` *"`SceneBuilderPromptBox` deleted
   (MCP not ready)"*; `:124` *"Update is still an MCP stub … it does NOT call the MCP backend
   yet"*; `:432` *"JSON-style, MCP-esque backend integration (in development)"*; `:145` and
   `:511` list the *"real MCP backend"* as deferred/out of scope.

### 5. Closest thing to headless: screenshot diagnostics, not a command surface

`artcraft-native/src/app.rs` reads four environment variables at launch (three diagnostics).
They drive the GUI and take no commands:

- `:125` `ARTCRAFT_PAGE` — start on a named page.
- `:137-138` `ARTCRAFT_OPEN` — open a dialog at launch (`settings`, `midjourney-login`).
- `:902-903` *"`ARTCRAFT_SCREENSHOT=<file.png>` saves a screenshot once the window has
  settled (and `ARTCRAFT_SCREENSHOT_EXIT=1` then closes the app), for checking the UI
  headlessly"*; implemented at `:915-918` and `:920-934`.

That is CI screenshot tooling for a GUI session (window must open, 8-second settle at
`:913`), not headless editing, and it produces no document artifacts.

### 6. The real programmatic surface is a hosted HTTP API

`repos/artcraft/_docs/artcraft_omni_api.md:8-10` describes the **Omni API**: *"the
API-key–authenticated surface for ArtCraft generation … designed for programmatic use"*;
base URLs at `:23-26` are `https://api.storyteller.ai` (production) and
`http://localhost:12345` (development); API keys are gated per account (`:38-44`).

That is a network API against ArtCraft's servers, not a local craft CLI: it has no
`commands` catalog, no `run --cmd`, no local document files, and no offline operation. It
does not fit `CraftProfile` (which is built around `discoverCraft` finding an executable and
`buildRunArgv` spawning it — `dsh-plugins/craft-kit/src/discover.ts:111-116`,
`exec.ts:131-187`).

## `repos/artcraftx`

- ArtCraft-X is *"A minimal desktop app for AI creation"* (`artcraftx/README.md:7`) — a
  pared-down Tauri app, again no CLI. Its only `[[bin]]` in the whole workspace is
  `harvest_statsig` (`crates/api_clients/grok_consumer_statsig/Cargo.toml:13-15`), an
  internal dev utility for Grok statsig harvesting, unrelated to crafting.
- The app crate is a Tauri lib: `crates/artcraftx/Cargo.toml:17-19`
  (`crate-type = ["staticlib", "cdylib", "rlib"]`, `tauri-build` at `:21-22`).
- It documents *"native Tauri IPC, so there is no second backend HTTP port to allocate"*
  (`README.md:50-51`) — the same in-webview-only IPC as ArtCraft.
- State of the project: *"**Early Experimental Release** — Builds are Forthcoming"*
  (`README.md:26-27`). Confirmed externally:
  `GET https://api.github.com/repos/storytold/artcraftx/releases?per_page=5` (HTTP 200)
  returned `[]` — **zero releases**, so not even a GUI installer exists to wrap, let alone
  a CLI.
- It has no `.github/` directory in the checkout (no release workflow at all).

## Why no `CraftProfile` was added

The task says to add a profile-shaped description only *if there is a real CLI entry point*.
There is none:

1. no CLI binary exists locally or in any published release (verified above);
2. no crate in either repo produces one (no `clap`, no CLI `[[bin]]`, no `apps/*-cli`);
3. the app has no headless mode, no command catalog, no local control channel;
4. the MCP surface is a *hosted-service credential flow* plus an explicitly unfinished UI
   stub — not something a local `CraftProfile` can spawn;
5. the Omni HTTP API is real but is not the craft-CLI shape the kernel models.

Adding `{ id: 'artcraft', bin: 'artcraft-cli', … }` to
`dsh-plugins/craft-kit/src/profiles.mjs` would make `artcraft-cli` permanently
undiscoverable and would advertise tools that can never run. **The kernel was not edited.**

## What would change this verdict

Any one of these would justify a profile (or a different kind of plugin):

- a `storytold/artcraft` release asset that is an executable CLI, or an
  `apps/artcraft-cli` crate with `info`/`run`/`commands`/`mcp` subcommands;
- a documented local control channel in the desktop app (the way the sibling
  `*-cli app --port` talks to a running app);
- the "real MCP backend" landing (then an MCP-bridge plugin, not a `CraftProfile`, is the
  right shape — the kernel already has an MCP bridge as a stated consumer);
- an ArtCraft-hosted MCP server with a documented tool list (then the plugin would be a
  thin HTTP/MCP client, and `CraftPluginConfig.path`-style discovery would make no sense).

### Appendix — hypothetical profile shape (NOT implemented, NOT verified)

Shown only to make the gap concrete; none of these flags exist today.

```js
// HYPOTHETICAL — do not copy into craft-kit without a real CLI to verify against.
{
  id: 'artcraft',
  product: 'ArtCraft',
  bin: 'artcraft-cli',            // no such binary exists (crafts-bin/ has none; no release asset)
  envVar: 'ARTCRAFT_CLI',         // not read by any ArtCraft binary (only ARTCRAFT_PAGE/OPEN/SCREENSHOT*)
  searchDirs: ['crafts-bin'],
  extensions: [],                 // the app has no document file format of its own
  run: { /* no run subcommand exists */ },
}
```
