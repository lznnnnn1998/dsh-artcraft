/**
 * Host-environment primitives that make every script behave identically on
 * Windows, macOS and Linux.
 *
 * Four differences are large enough to need code rather than care, and each one
 * has been hit for real on a stock Windows 11 box:
 *
 *   1. **`import()` needs a URL on Windows.** `import('E:\\a\\b.js')` is parsed
 *      as the protocol `e:` and throws `ERR_UNSUPPORTED_ESM_URL_SCHEME: On
 *      Windows, absolute paths must be valid file:// URLs`. Every dynamic
 *      import of a computed path must go through {@link loadModule}.
 *   2. **Package managers are `.cmd` shims on Windows.** Node refuses to spawn a
 *      `.cmd` without a shell (`EINVAL`) and never applies `PATHEXT` itself
 *      (`ENOENT`), so `execFileSync('pnpm', …)` cannot work. {@link packageManager}
 *      finds something runnable — preferably the `pnpm.mjs` the harness already
 *      ships, which needs no shim and no shell at all.
 *   3. **Directory symlinks need Developer Mode or elevation on Windows.**
 *      Junctions do not, so {@link linkDir} creates one on Windows.
 *   4. **PATH is `;`-separated and case-insensitive on Windows**, and a binary is
 *      only found with the right extension; {@link findOnPath} handles both.
 *
 * Nothing here is craft-specific: the same helpers serve install, link, verify
 * and catalog generation.
 * @module scripts/lib/host
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** True when the current process runs on Windows. */
export const isWindows = process.platform === 'win32'

/**
 * Read a text file, dropping a UTF-8 byte-order mark.
 *
 * Windows editors and PowerShell 5.1's `Set-Content -Encoding UTF8` write a
 * BOM, and `JSON.parse` rejects one, so a hand-edited profile `package.json`
 * would otherwise fail the installer with a bare `SyntaxError`.
 * @param path - file to read.
 * @returns the file's text with any leading BOM removed.
 */
export function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
}

/**
 * Read and parse a JSON file, tolerating a UTF-8 BOM.
 * @param path - the `.json` file to read.
 * @returns the parsed value.
 */
export function readJson(path) {
  return JSON.parse(readText(path))
}

/**
 * Write JSON with a trailing newline, and no byte-order mark.
 *
 * `writeFileSync` with a string never adds a BOM, which is what makes these
 * files portable back to macOS and Linux.
 * @param path - file to write.
 * @param value - the value to serialize.
 * @param indent - spaces of indentation; defaults to two.
 */
export function writeJson(path, value, indent = 2) {
  writeFileSync(path, `${JSON.stringify(value, undefined, indent)}\n`)
}

/**
 * A filesystem path as a URL string usable by `import()`.
 *
 * On POSIX this is a formality; on Windows it is the difference between loading
 * a module and an `ERR_UNSUPPORTED_ESM_URL_SCHEME` throw.
 * @param path - an absolute or relative filesystem path.
 * @returns an `import()`-safe URL string.
 */
export function moduleUrl(path) {
  return pathToFileURL(resolve(path)).href
}

/**
 * Import an ES module from a computed filesystem path, on any platform.
 * @param path - absolute or relative path to the module.
 * @returns the module namespace object.
 */
export function loadModule(path) {
  return import(moduleUrl(path))
}

/**
 * Create a directory link that works without elevation on every platform.
 *
 * Windows uses a junction: it resolves absolute local directories, needs no
 * Developer Mode and no administrator, and `lstat` still reports it as a
 * symbolic link, so the idempotency checks in the callers keep working.
 * @param source - the directory to point at; must be absolute on Windows.
 * @param target - the link path to create.
 */
export function linkDir(source, target) {
  if (isWindows) {
    symlinkSync(resolve(source), target, 'junction')
    return
  }
  symlinkSync(source, target, 'dir')
}

/**
 * The real directory a link currently points at.
 *
 * `realpath` is used rather than `readlink` because a Windows junction reports
 * its target with a `\\?\` prefix, which no longer compares equal to a plain
 * path; resolving both sides makes the check portable.
 * @param target - the link path.
 * @returns the resolved directory, or `undefined` when it is not a link.
 */
export function readLinkTarget(target) {
  try {
    return realpathSync(target)
  } catch {
    return undefined
  }
}

/** File extensions Windows treats as executable, from `PATHEXT` when set. */
function windowsExtensions(env) {
  const raw = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  return raw.split(';').map(ext => ext.trim()).filter(ext => ext.length > 0)
}

/**
 * Find an executable by name, the way a shell would.
 *
 * Node's own `spawn` accepts no extension-less name on Windows, so each
 * `PATHEXT` suffix is tried explicitly. Names that already carry a path
 * separator or an extension are tested as given.
 * @param name - the command name (`pnpm`) or a path.
 * @param env - the environment whose `PATH` to search; defaults to `process.env`.
 * @returns the absolute path, or `undefined` when nothing matches.
 */
export function findOnPath(name, env = process.env) {
  const suffixes = isWindows && !/\.[a-z0-9]+$/i.test(name) ? ['', ...windowsExtensions(env)] : ['']
  const dirs = name.includes('/') || name.includes('\\')
    ? ['']
    : (env.PATH ?? env.Path ?? '').split(delimiter).filter(entry => entry.length > 0)
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = dir.length === 0 ? `${name}${suffix}` : join(dir, `${name}${suffix}`)
      const full = isAbsolute(candidate) ? candidate : resolve(candidate)
      try {
        if (statSync(full).isFile()) return full
      } catch {
        // Not here; try the next extension or directory.
      }
    }
  }
  return undefined
}

/**
 * Whether a resolved path is a Windows script shim that needs a shell.
 * @param path - the resolved command path.
 * @returns true for `.cmd` and `.bat`.
 */
export function needsShell(path) {
  return isWindows && /\.(cmd|bat)$/i.test(path)
}

/**
 * Quote one argument for `cmd.exe`.
 *
 * Spaces and shell metacharacters are wrapped in quotes. `%` is refused rather
 * than mangled: `cmd.exe` expands `%NAME%` even inside quotes, and there is no
 * escape that survives on a `cmd /c` command line, so silently passing a
 * corrupted path would be worse than saying so.
 * @param value - one argument.
 * @returns the argument, quoted when necessary.
 * @throws when the argument contains a character cmd.exe cannot be given.
 */
function cmdQuote(value) {
  if (/[%!]/.test(value)) {
    throw new Error(
      `cannot pass ${JSON.stringify(value)} to cmd.exe: '%' and '!' are expanded by the shell.\n`
      + `Set ${PM_ENV} to a pnpm/npm executable or a pnpm.mjs path, or move the project to a path without those characters.`,
    )
  }
  return /[\s"&|<>^()]/.test(value) ? `"${value}"` : value
}

/**
 * Run a command and wait for it, on any platform.
 *
 * A Windows `.cmd`/`.bat` shim is handed to `cmd.exe`, which is the only way
 * Node is allowed to start one. Everything else is spawned directly, so no
 * argument is ever reinterpreted by a shell.
 * @param command - a command name or path (`pnpm`, `node`, `C:\\…\\git.exe`).
 * @param args - arguments, passed verbatim.
 * @param options - `child_process` options (`cwd`, `encoding`, `stdio`, `timeout`).
 * @returns whatever `execFileSync` returns for the given `options`.
 */
export function runTool(command, args, options = {}) {
  const resolved = findOnPath(command) ?? command
  if (needsShell(resolved)) {
    const line = [resolved, ...args].map(cmdQuote).join(' ')
    // `/d` skips AutoRun, `/s` makes the outer quotes around `line` unambiguous.
    const shell = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe'
    return execFileSync(shell, ['/d', '/s', '/c', `"${line}"`], options)
  }
  return execFileSync(resolved, args, options)
}

/**
 * A package manager this machine can actually run.
 *
 * `command` plus `prefixArgs` is the complete invocation, so a `.mjs` entry
 * point (`node pnpm.mjs`) and a real executable look the same to callers.
 */

/** Environment variable that overrides package-manager autodetection. */
export const PM_ENV = 'DSH_ARTCRAFT_PM'

/**
 * Candidate `pnpm.mjs` entry points shipped inside a DeepSeek Harness install.
 *
 * The harness bundles its own pnpm beside its bundled Node, which is why an
 * install can work on a machine with no global npm or pnpm at all — the common
 * case on Windows, where neither is on `PATH` by default.
 * @returns absolute candidate paths, most likely first.
 */
function bundledPnpmCandidates() {
  const candidates = []
  const fromEnv = process.env.DSH_PNPM
  if (fromEnv !== undefined && fromEnv.length > 0) candidates.push(fromEnv)
  // <runtime>/dependencies/node/bin/node.exe → <runtime>/dependencies/pnpm/bin/pnpm.mjs
  candidates.push(resolve(dirname(process.execPath), '..', '..', 'pnpm', 'bin', 'pnpm.mjs'))
  // <home>/.dsh/dsh-runtimes/<runtime>/dependencies/pnpm/bin/pnpm.mjs
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const runtimes = join(dshHome, 'dsh-runtimes')
  try {
    for (const entry of readdirSync(runtimes, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(runtimes, entry.name, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'))
    }
  } catch {
    // No runtimes directory; the other candidates still apply.
  }
  return candidates
}

/**
 * Resolve the package manager to install and pack with.
 *
 * Order: `$DSH_ARTCRAFT_PM` → the pnpm bundled with the harness → `pnpm` on
 * `PATH` → `corepack` → `npm` on `PATH`. The bundled copy wins over a `PATH`
 * shim deliberately: it needs no shell, so it behaves the same on Windows as
 * everywhere else.
 * @returns a description with `label`, `command`, `prefixArgs` and `source`.
 * @throws when nothing usable is installed, with the per-candidate reasons.
 */
export function packageManager() {
  const override = process.env[PM_ENV]
  if (override !== undefined && override.length > 0) {
    const path = findOnPath(override) ?? (existsSync(override) ? resolve(override) : undefined)
    if (path === undefined) throw new Error(`${PM_ENV} is set to "${override}", which was not found`)
    return path.endsWith('.mjs') || path.endsWith('.cjs') || path.endsWith('.js')
      ? { label: path, command: process.execPath, prefixArgs: [path], source: PM_ENV }
      : { label: path, command: path, prefixArgs: [], source: PM_ENV }
  }

  const tried = []
  for (const candidate of bundledPnpmCandidates()) {
    if (!existsSync(candidate)) { tried.push(`${candidate} — not found`); continue }
    return { label: `pnpm (bundled with DSH)`, command: process.execPath, prefixArgs: [candidate], source: candidate }
  }

  for (const name of ['pnpm', 'corepack', 'npm']) {
    const path = findOnPath(name)
    if (path === undefined) { tried.push(`${name} — not on PATH`); continue }
    // `corepack pnpm …` is how corepack spells it.
    return {
      label: name === 'corepack' ? 'pnpm (via corepack)' : name,
      command: path,
      prefixArgs: name === 'corepack' ? ['pnpm'] : [],
      source: path,
    }
  }

  throw new Error(
    'no package manager found — install pnpm or npm, or set '
    + `${PM_ENV} to a pnpm/npm command or a path to pnpm.mjs\n`
    + tried.map(line => `  ${line}`).join('\n'),
  )
}

/**
 * Run the resolved package manager with extra arguments.
 * @param pm - the value returned by {@link packageManager}.
 * @param args - arguments after the manager's own prefix.
 * @param options - `child_process` options.
 * @returns whatever `execFileSync` returns.
 */
export function runPackageManager(pm, args, options = {}) {
  return runTool(pm.command, [...pm.prefixArgs, ...args], options)
}

/**
 * Locate a Node.js executable this machine can run.
 *
 * Used by the Windows bootstrap, where `node` is often not on `PATH` even
 * though the harness ships one, and by diagnostics that report what was found.
 * @returns the absolute path of a usable `node`, or `undefined`.
 */
export function findNode() {
  const onPath = findOnPath('node')
  if (onPath !== undefined) return onPath
  if (process.execPath !== undefined && existsSync(process.execPath)) return process.execPath
  const names = isWindows ? ['node.exe'] : ['node']
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
    homedir(),
  ].filter((root) => typeof root === 'string' && root.length > 0)
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, 'nodejs', name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Parse a script's argv without guessing.
 *
 * The scripts previously searched `argv` for each flag, which silently
 * mis-parses a boolean flag followed by a positional: `install-craft.mjs --force
 * gridcraft` skipped `gridcraft` and installed all twelve crafts. Declaring the
 * flags that consume a value removes the ambiguity for every platform.
 * @param argv - the arguments after the script name.
 * @param valueFlags - flags that take the following argument as their value;
 *   `--flag=value` is accepted for any flag.
 * @returns accessors for flags, values and positionals.
 * @throws when a value-taking flag is given no value.
 */
export function parseArgv(argv, valueFlags = []) {
  const takesValue = new Set(valueFlags)
  const flags = new Set()
  const values = new Map()
  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { positionals.push(arg); continue }
    const equals = arg.indexOf('=')
    if (equals !== -1) {
      const name = arg.slice(0, equals)
      flags.add(name)
      values.set(name, arg.slice(equals + 1))
      continue
    }
    if (!takesValue.has(arg)) { flags.add(arg); continue }
    const next = argv[index + 1]
    if (next === undefined) throw new Error(`${arg} needs a value`)
    flags.add(arg)
    values.set(arg, next)
    index += 1
  }
  return {
    flags,
    values,
    positionals,
    /** True when `name` was passed. */
    has: (name) => flags.has(name),
    /** The value of `name`, or `fallback` when it was not passed. */
    value: (name, fallback) => (values.has(name) ? values.get(name) : fallback),
  }
}

/**
 * A platform-appropriate one-liner for installing a Rust toolchain.
 *
 * The `curl | sh` line every Rust guide prints is wrong on Windows, where the
 * supported entry point is `rustup-init.exe`.
 * @returns a suggestion suitable for printing to the user.
 */
export function rustInstallHint() {
  return isWindows
    ? 'winget install --id Rustlang.Rustup   (or download https://win.rustup.rs/x86_64 and run rustup-init.exe)'
    : 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'
}

/**
 * How to spell "set an environment variable" in the user's own shell.
 * @param name - the variable name.
 * @param value - an example value.
 * @returns a shell-appropriate assignment.
 */
export function envAssignmentHint(name, value) {
  return isWindows ? `$env:${name}="${value}"` : `${name}=${value}`
}

/**
 * The default per-user state directory for the harness, on any platform.
 * @returns an absolute path.
 */
export function defaultDshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}
