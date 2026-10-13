/**
 * Build a craft CLI from its own source with Cargo.
 *
 * The alternative to `scripts/install-craft.mjs` is downloading a release
 * binary. That is faster to first run, but it only covers the platforms
 * upstream publishes, gives no control over version or patches, and cannot
 * work from a checkout you already have. This builds instead, and it is
 * cheaper than it looks: each craft's `*-cli` crate does **not** depend on the
 * GUI stack, so a release build is roughly a minute and a few hundred
 * megabytes of `target/`, not the multi-hour egui/wgpu build the whole
 * application would need.
 *
 * @module scripts/lib/source-build
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Cargo invocations this module needs, resolved from `PATH`. */
export interface CargoTools {
  readonly cargo: string
  readonly rustc: string
  readonly version: string
}

/**
 * Locate a usable Rust toolchain.
 *
 * `~/.cargo/bin` is on `PATH` for an interactive shell but not for a GUI or a
 * systemd unit, so it is checked explicitly after `PATH`.
 * @returns the tools, or `undefined` when Rust is not installed.
 */
export function findCargo(): CargoTools | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const candidates = [
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean),
    join(home, '.cargo', 'bin'),
  ]
  for (const dir of candidates) {
    const cargo = join(dir, process.platform === 'win32' ? 'cargo.exe' : 'cargo')
    if (!existsSync(cargo)) continue
    try {
      const version = execFileSync(cargo, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim()
      const rustc = join(dir, process.platform === 'win32' ? 'rustc.exe' : 'rustc')
      return { cargo, rustc: existsSync(rustc) ? rustc : 'rustc', version }
    } catch {
      // A broken toolchain on PATH should not stop the search.
    }
  }
  return undefined
}

/**
 * The Cargo package name of a craft's CLI binary.
 *
 * The crate directory is usually `<craft>-cli`, but Cargo allows a package name
 * that differs from its directory, so the workspace members are read and each
 * candidate manifest inspected for the package whose name ends in `-cli`.
 * @param repoDir - the craft repository root.
 * @param craft - the craft id, e.g. `gridcraft`.
 * @returns the package name, or `undefined` when no CLI crate exists.
 */
export function findCliPackage(repoDir: string, craft: string): string | undefined {
  const rootManifest = join(repoDir, 'Cargo.toml')
  if (!existsSync(rootManifest)) return undefined
  const manifest = readFileSync(rootManifest, 'utf8')

  // Workspace members: `members = ["crates/*", "apps/*", "xtask"]`, possibly
  // spread over several lines.
  const memberMatch = /members\s*=\s*\[([^\]]*)\]/s.exec(manifest)
  const patterns = memberMatch === null
    ? []
    : [...memberMatch[1].matchAll(/"([^"]+)"/g)].map(match => match[1])

  const manifestPaths: string[] = []
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const [head, tail] = pattern.split('*')
      const base = join(repoDir, head.replace(/\/$/, ''))
      if (!existsSync(base)) continue
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.endsWith(tail.replace(/^\//, ''))) {
          manifestPaths.push(join(base, entry.name, 'Cargo.toml'))
        }
      }
    } else {
      manifestPaths.push(join(repoDir, pattern, 'Cargo.toml'))
    }
  }
  // The likely crate first: `<craft>-cli`, then anything else ending in `-cli`.
  manifestPaths.sort((a, b) => Number(b.includes(`${craft}-cli`)) - Number(a.includes(`${craft}-cli`)))

  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) continue
    const text = readFileSync(manifestPath, 'utf8')
    const nameMatch = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)
    const name = nameMatch?.[1]
    if (name === undefined) continue
    if (name === `${craft}-cli`) return name
  }
  // Fall back to any member whose package name ends in `-cli`.
  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) continue
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(manifestPath, 'utf8'))?.[1]
    if (name !== undefined && name.endsWith('-cli')) return name
  }
  return undefined
}

/** Result of one source build. */
export interface SourceBuildResult {
  readonly ok: boolean
  /** Absolute path of the built binary, when the build succeeded. */
  readonly binary?: string
  /** Cargo's own output tail, for diagnostics. */
  readonly log: string
  readonly seconds: number
}

/**
 * Build one craft's CLI crate in release mode.
 * @param options - repository directory, craft id, and an optional progress sink.
 * @returns the built binary path or the failure log.
 */
export function buildCraftCli(
  options: {
    readonly repoDir: string
    readonly craft: string
    readonly cargo: CargoTools
    readonly features?: readonly string[]
    readonly onProgress?: (line: string) => void
  },
): SourceBuildResult {
  const { repoDir, craft, cargo, features, onProgress } = options
  const started = Date.now()
  const pkg = findCliPackage(repoDir, craft)
  if (pkg === undefined) {
    return { ok: false, log: `no *-cli crate found in ${repoDir}/Cargo.toml members`, seconds: 0 }
  }

  const args = ['build', '--release', '-p', pkg]
  for (const feature of features ?? []) args.push('--features', feature)
  const result = spawnSync(cargo.cargo, args, {
    cwd: repoDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
  })
  const log = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  for (const line of log.split('\n').slice(-6)) onProgress?.(line)

  if (result.status !== 0) {
    return { ok: false, log: log.split('\n').slice(-25).join('\n'), seconds: (Date.now() - started) / 1000 }
  }
  const name = process.platform === 'win32' ? `${pkg}.exe` : pkg
  const binary = join(repoDir, 'target', 'release', name)
  if (!existsSync(binary)) {
    return { ok: false, log: `cargo reported success but ${binary} is missing`, seconds: (Date.now() - started) / 1000 }
  }
  return { ok: true, binary, log: log.split('\n').slice(-3).join('\n'), seconds: (Date.now() - started) / 1000 }
}

/**
 * Copy a built binary into the install directory under the name the plugins
 * look for.
 * @param built - the compiled binary.
 * @param installDir - destination directory.
 * @param targetName - filename to install as (`<craft>-cli[.exe]`).
 * @returns the installed path.
 */
export function installBinary(built: string, installDir: string, targetName: string): string {
  mkdirSync(installDir, { recursive: true })
  const destination = join(installDir, targetName)
  copyFileSync(built, destination)
  if (process.platform !== 'win32') chmodSync(destination, 0o755)
  return destination
}

/** Absolute path helper for callers that hold a repo root. */
export function repoPath(reposDir: string, craft: string): string {
  return resolve(join(reposDir, craft))
}

/** True when a directory looks like a cloned craft repository. */
export function looksLikeRepo(dir: string): boolean {
  return existsSync(join(dir, 'Cargo.toml'))
}

/** The parent directory of a path, re-exported so callers need one import. */
export const parentDir = dirname
