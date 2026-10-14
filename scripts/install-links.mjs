#!/usr/bin/env node
/**
 * Link the plugins' harness dependencies and the shared kernel.
 *
 * A plugin package imports three bare specifiers:
 *
 *   `@deepseek-ai/cordis`      — the plugin framework (must be the *same*
 *   `@deepseek-ai/dsh-tools`   — instance the harness runs, or the Context the
 *                                plugin receives is not the harness's)
 *   `@dsh-artcraft/craft-kit`  — this workspace's shared kernel
 *
 * `node_modules` is not committed, so a fresh clone must recreate those links.
 * This script finds the deepseek-harness checkout, verifies the two harness
 * packages are present (a checkout that was never installed lacks their built
 * `lib/`), and links everything into place. It is idempotent and also runs
 * from `dsh-plugins/`'s `postinstall`.
 *
 * On Windows the links are **junctions**, which need neither Developer Mode nor
 * an elevated shell; a plain directory symlink would fail with `EPERM` on a
 * stock machine.
 *
 * Usage:
 *   node scripts/install-links.mjs                 # autodetect the harness
 *   node scripts/install-links.mjs --harness DIR   # or name it explicitly
 *   node scripts/install-links.mjs --check         # report only, never write
 *   node scripts/install-links.mjs --optional      # warn, do not fail, when absent
 * @module scripts/install-links
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWindows, linkDir, parseArgv, envAssignmentHint } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')
const args = parseArgv(process.argv.slice(2), ['--harness'])
const checkOnly = args.has('--check')
/**
 * `--optional` makes a missing harness checkout a warning instead of a failure.
 *
 * The workspace's `postinstall` uses it: linking the peers only matters once
 * the plugins are actually loaded, and failing there would make
 * `pnpm install` in `dsh-plugins/` impossible on a machine that has no harness
 * source checkout.
 */
const optional = args.has('--optional')
const explicitHarness = args.value('--harness', undefined)

/**
 * Harness packages a plugin imports, and the file that proves a checkout is
 * usable. An unbuilt checkout has the directory but not the entry point.
 */
const HARNESS_PACKAGES = [
  { name: '@deepseek-ai/cordis', dir: 'vendor/cordis', entry: 'lib/index.js' },
  { name: '@deepseek-ai/dsh-tools', dir: 'packages/core/tools', entry: 'lib/index.js' },
]

/** Places a deepseek-harness checkout plausibly lives. */
function harnessCandidates() {
  const fromEnv = process.env.DSH_HARNESS_DIR
  return [
    ...explicitHarness !== undefined ? [explicitHarness] : [],
    ...fromEnv !== undefined && fromEnv.length > 0 ? [fromEnv] : [],
    join(root, '..', 'deepseek-harness'),
    join(root, '..', '..', 'deepseek-harness'),
    join(homedir(), 'deepseek-harness'),
    join(homedir(), 'Documents', 'deepseek-harness'),
    join(homedir(), 'src', 'deepseek-harness'),
    join(homedir(), 'code', 'deepseek-harness'),
  ].filter(candidate => candidate !== undefined)
}

/**
 * Find a usable harness checkout: one whose packages exist *and* are built.
 * @returns the absolute checkout path, or `undefined` with reasons collected.
 */
function findHarness() {
  const seen = []
  for (const candidate of harnessCandidates()) {
    const full = resolve(candidate)
    if (!existsSync(full)) { seen.push(`  ${full} — not found`); continue }
    const missing = HARNESS_PACKAGES.filter(pkg => !existsSync(join(full, pkg.dir, pkg.entry)))
    if (missing.length > 0) {
      seen.push(`  ${full} — found, but not built (missing ${missing.map(m => `${m.dir}/${m.entry}`).join(', ')})`)
      continue
    }
    return { path: full, seen }
  }
  return { path: undefined, seen }
}

const { path: harness, seen } = findHarness()

if (harness === undefined) {
  console.error(optional
    ? 'No usable deepseek-harness checkout was found, so the plugin peers were not linked.\n'
    : 'Could not find a usable deepseek-harness checkout.\n')
  if (optional) {
    console.error('That is fine unless you mean to load the plugins from this workspace: profiles')
    console.error('installed by scripts/install-into-profile.mjs resolve their peers from the')
    console.error('harness itself and need nothing linked here.\n')
  }
  console.error('Looked in:')
  for (const line of [...new Set(seen)]) console.error(line)
  const example = isWindows ? 'C:\\src\\deepseek-harness' : '/path/to/deepseek-harness'
  console.error(`
The plugins must import the same cordis instance the harness runs, so they need
a built harness checkout. Fix it with either:

  1. clone and build it:   git clone https://github.com/deepseek-ai/deepseek-harness
                           then, in that checkout:  pnpm install && pnpm run build
  2. point at an existing one:
                           node scripts/install-links.mjs --harness ${example}
                           ${envAssignmentHint('DSH_HARNESS_DIR', example)}
${isWindows ? `
On Windows the harness ships its own package manager, so no global pnpm is
needed — run it with the Node the harness uses:
  node "%USERPROFILE%\\.dsh\\dsh-runtimes\\<runtime>\\dependencies\\pnpm\\bin\\pnpm.mjs" install
` : ''}`)
  process.exit(optional ? 0 : 2)
}

/** Plugin packages present in this workspace. */
function pluginPackages() {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
    .map(entry => ({ dir: join(pluginsDir, entry.name), craft: entry.name.slice('plugin-'.length) }))
    .filter(entry => existsSync(join(entry.dir, 'package.json')))
    .sort((a, b) => a.craft.localeCompare(b.craft))
}

/** Create `target` as a link to `source`, replacing a stale link. */
function link(source, target) {
  const existing = lstatSync(target, { throwIfNoEntry: false })
  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) return { ok: false, reason: `${target} exists and is not a link` }
    rmSync(target)
  }
  if (checkOnly) return { ok: true, reason: 'would link' }
  mkdirSync(dirname(target), { recursive: true })
  try {
    linkDir(source, target)
  } catch (error) {
    const fix = isWindows
      ? 'Re-run from an elevated shell, or enable Developer Mode.'
      : 'Check the directory permissions.'
    return { ok: false, reason: `${target}: ${error.message}. ${fix}` }
  }
  return { ok: true, reason: 'linked' }
}

const plugins = pluginPackages()
if (plugins.length === 0) {
  console.error(`no plugin-* packages under ${pluginsDir}`)
  process.exit(1)
}

const kernelDir = join(pluginsDir, 'craft-kit')
if (!existsSync(join(kernelDir, 'lib', 'index.js'))) {
  console.error('dsh-plugins/craft-kit/lib is missing — run: node scripts/build-kit.mjs')
  process.exit(2)
}

let failures = 0
const targets = [
  { owner: pluginsDir, label: 'workspace' },
  ...plugins.map(plugin => ({ owner: plugin.dir, label: plugin.craft })),
]

for (const target of targets) {
  const modules = join(target.owner, 'node_modules')
  // The kernel lives outside plugin-*, so it is linked by name too.
  const kernel = link(kernelDir, join(modules, '@dsh-artcraft', 'craft-kit'))
  if (!kernel.ok) { console.error(`${target.label}: ${kernel.reason}`); failures += 1 }
  for (const pkg of HARNESS_PACKAGES) {
    const result = link(join(harness, pkg.dir), join(modules, pkg.name))
    if (!result.ok) { console.error(`${target.label}: ${result.reason}`); failures += 1 }
  }
}

// pnpm's workspace file carries the harness paths so `pnpm install` can also
// produce these links; keep it in step with what autodetection found. The
// workspace file ships without a `dependencies:` block — a `link:` path that
// does not exist on this machine would make `pnpm install` fail before this
// script ever ran — so the block is appended the first time a harness is found.
//
// Both the match and the replacement are line-ending tolerant, and the paths
// are written with forward slashes: a default Windows checkout has CRLF line
// endings (`core.autocrlf=true`) and backslash `relative()` results, and a
// `\n`-only regex silently matched nothing there.
const workspaceFile = join(pluginsDir, 'pnpm-workspace.yaml')
if (!checkOnly && existsSync(workspaceFile)) {
  const harnessRelative = relative(pluginsDir, harness).split(sep).join('/')
  const text = readFileSync(workspaceFile, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const wanted = [
    'dependencies:',
    `  '@deepseek-ai/cordis': link:${harnessRelative}/vendor/cordis`,
    `  '@deepseek-ai/dsh-tools': link:${harnessRelative}/packages/core/tools`,
    '',
  ].join(eol)
  const block = /dependencies:\r?\n(?:  .*\r?\n)+/
  const updated = block.test(text)
    ? text.replace(block, wanted)
    : `${text.trimEnd()}${eol}${eol}# Written by scripts/install-links.mjs; do not edit by hand.${eol}${wanted}`
  if (updated !== text) writeFileSync(workspaceFile, updated)
}

if (failures > 0) {
  console.error(`\n${failures} link(s) failed`)
  process.exit(1)
}
console.log(`${checkOnly ? 'checked' : 'linked'} ${targets.length} node_modules tree(s)`)
console.log(`  harness: ${harness}`)
console.log(`  kernel:  ${kernelDir}`)
if (checkOnly) console.log('\n--check made no changes')
