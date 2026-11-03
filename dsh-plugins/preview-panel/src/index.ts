/**
 * ArtCraft live preview as a DSH client plugin.
 *
 * The browser half is the whole feature: `src/client.tsx` compiles to
 * `lib/client.js`, which the client module system serves at
 * `/plugins/dsh-artcraft-preview-panel/client.js` and materializes inside the
 * Web GUI. This entry exists so the package appears as an ordinary Cordis
 * Loader row — the `dsh.client` scan resolves the row's package root to find
 * the manifest and the `./client` bundle.
 *
 * Nothing in the host process participates: the panel fetches the layer-B
 * preview server (`http://127.0.0.1:4177`, see `docs/PREVIEW.md`) directly
 * from the browser.
 * @module dsh-artcraft-preview-panel
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4177

/** Where the craft plugins write previews; must match the kernel's default. */
function previewDirectory(): string {
  if (process.env.DSH_ARTCRAFT_PREVIEW_DIR !== undefined && process.env.DSH_ARTCRAFT_PREVIEW_DIR.length > 0) {
    return process.env.DSH_ARTCRAFT_PREVIEW_DIR
  }
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artcraft', 'preview')
}

/** Whether a preview server already answers; the port is shared, so never assume. */
async function serving(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/state`, { signal: AbortSignal.timeout(400) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Loader entry: start the preview server when it is not already running.
 *
 * The panel reads `http://127.0.0.1:4177/state`; a profile install has no
 * checkout to run it from, so the server ships inside this package (`server/`,
 * copied at build time from `scripts/preview/`). Starting it here means the
 * feature needs no second terminal; an already-running instance wins.
 */
export function apply(): void {
  const server = join(packageRoot, 'server', 'server.mjs')
  if (!existsSync(server)) return
  void serving().then((up) => {
    if (up) return
    const child = spawn(process.execPath, [server, '--port', String(PORT), '--dir', previewDirectory()], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    // A failed spawn is a lost feature, never a host crash: the emitter would
    // otherwise throw this 'error' event as an uncaught exception.
    child.on('error', () => {})
    child.unref()
  }).catch(() => {
    // The probe or the spawn failed; the panel's own notice explains the state.
  })
}
