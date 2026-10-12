/**
 * Locate a craft CLI on this machine.
 *
 * Search order is explicit and reported, because "the tool exists but the
 * binary was not found" is the single most likely failure a user hits:
 *   1. an explicit path written into `catalog/binaries.json` at install time,
 *   2. an explicit path in the plugin config,
 *   3. the craft's own environment variable (`GRIDCRAFT_CLI`, …),
 *   4. the documented search directories, resolved against the plugin package,
 *      the session cwd and this kernel (so the workspace `crafts-bin/` is found
 *      from wherever the plugin is loaded),
 *   5. `PATH`.
 * @module @dsh-artcraft/craft-kit/discover
 */

import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { CraftBinary, CraftProfile } from './types.ts'

/** True when `path` is an executable regular file (or a symlink to one). */
export function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Every directory on `PATH`, in order. */
function pathDirs(): string[] {
  return (process.env.PATH ?? '').split(delimiter).filter(entry => entry.length > 0)
}

/** Directory holding this kernel (`<workspace>/dsh-plugins/craft-kit/src`). */
const kernelDir = dirname(fileURLToPath(import.meta.url))

/**
 * Bases a relative search directory is resolved against.
 *
 * The plugin package root comes first: `<workspace>/dsh-plugins/plugin-x` and
 * `<workspace>/crafts-bin` are siblings, so `../crafts-bin` finds the
 * workspace's installed binaries no matter which directory the agent runs in.
 * @param packageRoot - the calling plugin's package root, when it has one.
 * @returns absolute bases, most specific first.
 */
function searchBases(packageRoot?: string): string[] {
  const bases = [
    ...packageRoot !== undefined ? [packageRoot, dirname(packageRoot)] : [],
    process.cwd(),
    // `<workspace>/dsh-plugins/craft-kit/src` → up three levels is the workspace.
    resolve(kernelDir, '..', '..', '..'),
    dirname(kernelDir),
  ]
  return [...new Set(bases)]
}

/** Absolute path recorded by `scripts/link-into-profile.mjs`, when present. */
function recordedBinary(profile: CraftProfile): { path: string; source: string } | undefined {
  for (const base of searchBases()) {
    const file = join(base, 'craft-kit', 'catalog', 'binaries.json')
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) continue
      const entry = (parsed as Record<string, unknown>)[profile.id]
      if (typeof entry === 'string' && entry.length > 0) return { path: entry, source: 'craft-kit/catalog/binaries.json' }
    } catch {
      // No record at this base; keep looking.
    }
  }
  return undefined
}

/**
 * Candidate absolute paths for one craft binary, in priority order, with provenance.
 * @param profile - the craft to locate.
 * @param configured - explicit path from plugin configuration, if any.
 * @param packageRoot - the calling plugin's package root, when it has one.
 * @returns candidates in the order they will be tested.
 */
export function candidates(profile: CraftProfile, configured?: string, packageRoot?: string): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = []
  if (configured !== undefined && configured.length > 0) out.push({ path: configured, source: 'config.path' })
  const fromEnv = process.env[profile.envVar]
  if (fromEnv !== undefined && fromEnv.length > 0) out.push({ path: fromEnv, source: `env:${profile.envVar}` })
  const recorded = recordedBinary(profile)
  if (recorded !== undefined) out.push(recorded)
  const seen = new Set<string>()
  for (const base of searchBases(packageRoot)) {
    for (const dir of profile.searchDirs) {
      const resolved = isAbsolute(dir) ? dir : resolve(base, dir)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      out.push({ path: join(resolved, profile.bin), source: `search-dir:${resolved}` })
    }
  }
  for (const dir of pathDirs()) out.push({ path: join(dir, profile.bin), source: 'PATH' })
  return out
}

/**
 * Resolve the craft CLI for `profile`.
 * @param profile - the craft to locate.
 * @param configured - explicit path from plugin configuration, if any.
 * @param packageRoot - the calling plugin's package root, when it has one.
 * @returns the first executable candidate and its provenance, or `undefined`.
 */
export function discoverCraft(profile: CraftProfile, configured?: string, packageRoot?: string): CraftBinary | undefined {
  for (const candidate of candidates(profile, configured, packageRoot)) {
    if (isExecutable(candidate.path)) return { path: candidate.path, source: candidate.source }
  }
  return undefined
}

/** Cached `--version` output per resolved path. */
const versionCache = new Map<string, string | undefined>()

/**
 * Read a craft binary's version, tolerating CLIs that spell the flag
 * differently (`--version` and `version` are both in use).
 * @param path - absolute path to the CLI.
 * @param timeoutMs - hard cap on the probe; a slow binary yields `undefined`.
 * @returns the first non-empty line of version output, or `undefined`.
 */
export function craftVersion(path: string, timeoutMs = 5000): string | undefined {
  if (versionCache.has(path)) return versionCache.get(path)
  let version: string | undefined
  for (const flag of ['--version', 'version']) {
    try {
      const out = execFileSync(path, [flag], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] })
      const line = out.split('\n').map(part => part.trim()).find(part => part.length > 0)
      if (line !== undefined) { version = line; break }
    } catch {
      // Try the next spelling; a missing flag is expected on some crafts.
    }
  }
  versionCache.set(path, version)
  return version
}

/**
 * A ready-to-print diagnostic for a craft binary that could not be found.
 * @param profile - the craft that was searched for.
 * @param configured - explicit path from plugin configuration, if any.
 * @param packageRoot - the calling plugin's package root, when it has one.
 * @returns multi-line guidance naming every searched location.
 */
export function missingBinaryMessage(profile: CraftProfile, configured?: string, packageRoot?: string): string {
  const tried = candidates(profile, configured, packageRoot)
  const lines = [
    `${profile.product}: '${profile.bin}' was not found, so the ${profile.id} tools cannot run.`,
    `Searched, in order:`,
    ...tried.slice(0, 10).map(entry => `  - ${entry.path}  (${entry.source})`),
  ]
  lines.push(
    `Fix it by any of:`,
    `  - run \`node scripts/fetch-binaries.mjs ${profile.id}\` in the dsh-artcraft workspace`,
    `  - set ${profile.envVar}=/absolute/path/to/${profile.bin}`,
    `  - download the CLI from https://github.com/storytold/${profile.id}/releases/latest and put it on PATH`,
    `  - pass { "path": "/absolute/path/to/${profile.bin}" } in this plugin's config`,
  )
  return lines.join('\n')
}
