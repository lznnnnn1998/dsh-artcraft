// Generated from src/index.ts by scripts/build.mjs — do not edit by hand.
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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The preview server's port.
 *
 * 4177 is the default rather than a constant so a second harness (or anything
 * else already on that port) can move the preview without patching the plugin.
 * The panel UI asks for `/state` relatively, so it follows automatically.
 */
const PORT = (() => {
    const raw = process.env.DSH_ARTCRAFT_PREVIEW_PORT;
    if (raw === undefined || raw.trim() === '')
        return 4177;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : 4177;
})();
/** Where the craft plugins write previews; must match the kernel's default. */
function previewDirectory() {
    if (process.env.DSH_ARTCRAFT_PREVIEW_DIR !== undefined && process.env.DSH_ARTCRAFT_PREVIEW_DIR.length > 0) {
        return process.env.DSH_ARTCRAFT_PREVIEW_DIR;
    }
    return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artcraft', 'preview');
}
/** Whether a preview server already answers; the port is shared, so never assume. */
async function serving() {
    try {
        const response = await fetch(`http://127.0.0.1:${PORT}/state`, { signal: AbortSignal.timeout(400) });
        return response.ok;
    }
    catch {
        return false;
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
export function apply() {
    const server = join(packageRoot, 'server', 'server.mjs');
    if (!existsSync(server))
        return;
    void serving().then((up) => {
        if (up)
            return;
        const child = spawn(process.execPath, [server, '--port', String(PORT), '--dir', previewDirectory()], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        // A failed spawn is a lost feature, never a host crash: the emitter would
        // otherwise throw this 'error' event as an uncaught exception.
        child.on('error', () => { });
        child.unref();
    }).catch(() => {
        // The probe or the spawn failed; the panel's own notice explains the state.
    });
}
