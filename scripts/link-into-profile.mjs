#!/usr/bin/env node
/**
 * Install the ArtCraft plugins into a DSH profile.
 *
 * A DSH plugin is an ordinary package the profile's `cordis.patch.yml` inserts
 * as a loader row. Two things must therefore be true:
 *
 *   1. the plugin package is reachable from the profile's `node_modules`, and
 *   2. each plugin's own bare imports (`@deepseek-ai/cordis`,
 *      `@deepseek-ai/dsh-tools`) resolve to the harness installation's single
 *      copies — a second Cordis instance would give the plugin a different
 *      `Context` than the one the harness hands it.
 *
 * Both are satisfied by linking each plugin package into the profile's
 * `node_modules`; Node then walks up from the plugin's real path for its peers,
 * and the plugin's own `node_modules` (created by the workspace) wins first.
 * On Windows the links are junctions, which need no Developer Mode and no
 * elevation. The profile's `cordis.patch.yml` is edited between marker
 * comments, so hand-written rows are never touched and re-running is
 * idempotent.
 *
 * Usage:
 *   node scripts/link-into-profile.mjs                     # profile from $DSH_HOME or ~/.dsh
 *   node scripts/link-into-profile.mjs --profile web
 *   node scripts/link-into-profile.mjs --dsh-home /tmp/dsh-smoke --profile web
 *   node scripts/link-into-profile.mjs --remove
 *   node scripts/link-into-profile.mjs --print             # show the patch rows only
 * @module scripts/link-into-profile
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDshHome, isWindows, linkDir, parseArgv, readJson, readLinkTarget } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')

const BEGIN = '# >>> dsh-artcraft plugins (managed by scripts/link-into-profile.mjs) >>>'
const END = '# <<< dsh-artcraft plugins <<<'

const args = parseArgv(process.argv.slice(2), ['--dsh-home', '--profile'])
const remove = args.has('--remove')
const printOnly = args.has('--print')

const dshHome = resolve(args.value('--dsh-home', defaultDshHome()))
const profileName = args.value('--profile', process.env.DSH_PROFILE ?? 'web')
const profileDir = join(dshHome, 'profiles', profileName)
const patchPath = join(profileDir, 'cordis.patch.yml')

/**
 * Plugin packages present in the workspace, in stable order.
 *
 * The package name is read from each manifest rather than reconstructed: the
 * plugins used to be scoped (`@dsh-artcraft/plugin-x`) and are now plain
 * `dsh-artcraft-plugin-x`, so anything that assumes one shape links the wrong
 * directory — or, for `name.split('/')[1]`, `undefined`.
 */
function pluginPackages() {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
    .map(entry => ({ dir: join(pluginsDir, entry.name), craft: entry.name.slice('plugin-'.length) }))
    .filter(entry => existsSync(join(entry.dir, 'package.json')))
    .map(entry => ({ ...entry, name: readJson(join(entry.dir, 'package.json')).name }))
    .sort((a, b) => a.craft.localeCompare(b.craft))
}

/** Where a package name lives inside a `node_modules` tree, scope and all. */
function packageDir(nodeModules, name) {
  return join(nodeModules, ...name.split('/'))
}

const plugins = pluginPackages()
if (plugins.length === 0) {
  console.error('no plugin-* packages found in dsh-plugins/')
  process.exit(1)
}

/**
 * The patch entry this script owns.
 *
 * A top-level row in `cordis.patch.yml` *targets* an existing entry by id, so
 * new plugin rows must arrive through one `insert` list. Emitting a single
 * insert entry keeps the managed block atomic and keeps hand-written rows free
 * of collisions.
 */
function patchRows() {
  const rows = [`${BEGIN}`]
  rows.push('# Add the ArtCraft craft plugins. Remove this block or run')
  rows.push('# `node scripts/link-into-profile.mjs --remove` to uninstall them.')
  // `insert` without an `id` appends to the root entry list; with an `id` it
  // would instead target an existing *group* row and warn when none matches.
  rows.push('- insert:')
  for (const plugin of plugins) {
    rows.push(`    - id: artcraft-${plugin.craft}`)
    rows.push(`      name: "${plugin.name}"`)
  }
  rows.push(END)
  return rows.join('\n')
}

if (printOnly) {
  console.log(patchRows())
  process.exit(0)
}

if (!existsSync(profileDir)) {
  console.error(`profile directory does not exist: ${profileDir}`)
  console.error(`available: ${existsSync(join(dshHome, 'profiles')) ? readdirSync(join(dshHome, 'profiles')).join(', ') || '(none)' : '(no profiles directory)'}`)
  process.exit(2)
}

const nodeModules = join(profileDir, 'node_modules')
mkdirSync(nodeModules, { recursive: true })

let linked = 0
let skipped = 0
for (const plugin of plugins) {
  const target = packageDir(nodeModules, plugin.name)
  const desired = resolve(plugin.dir)
  const existing = lstatSync(target, { throwIfNoEntry: false })
  if (existing !== undefined) {
    if (remove) { rmSync(target, { recursive: true, force: true }); continue }
    if (!existing.isSymbolicLink()) {
      console.error(`refusing to replace a real directory: ${target}`)
      skipped += 1
      continue
    }
    // Already pointing where it should: recreating the link would be pure churn.
    if (readLinkTarget(target) === desired) { linked += 1; continue }
    rmSync(target, { force: true })
  } else if (remove) {
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  try {
    linkDir(desired, target)
  } catch (error) {
    console.error(`${target}: ${error.message}`)
    console.error(isWindows
      ? 'Junctions normally need no elevation; if this persists, run once from an elevated shell.'
      : 'Check the directory permissions.')
    skipped += 1
    continue
  }
  linked += 1
}

// Rewrite only the managed block; every other line of the patch stays
// byte-identical. The file's own line ending is preserved, because a profile
// edited on Windows has CRLF and mixing the two in one YAML file is needless.
const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
const eol = original.includes('\r\n') ? '\r\n' : '\n'
const withoutBlock = original
  .replace(new RegExp(`\\r?\\n?\\s*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\r?\\n?`, 'g'), '\n')
  .trimEnd()

/**
 * A profile's `cordis.patch.yml` starts as a comment block plus `[]` — an
 * empty entry list. Rows cannot be appended to `[]`, so the placeholder is
 * dropped the first time this script writes the block, and restored when the
 * last managed row is removed. Comments are **kept**: they are the profile's own
 * documentation, and dropping them would make the script destructive in a way
 * that is hard to notice.
 */
const stripPlaceholder = (text) => text
  .split(/\r?\n/)
  .filter(line => line.trim() !== '[]')
  .join(eol)
  .trimEnd()

const withoutPlaceholder = stripPlaceholder(withoutBlock)
// A patch file must keep an entry list: comments alone would parse as no YAML
// document at all, so the empty `[]` is restored once the last row is removed.
const hasEntries = withoutPlaceholder.split(/\r?\n/).some((line) => {
  const trimmed = line.trim()
  return trimmed.length > 0 && !trimmed.startsWith('#')
})
const rows = patchRows().split('\n').join(eol)

let updated
if (remove) {
  const kept = withoutPlaceholder.length === 0 ? '[]'
    : (hasEntries ? withoutPlaceholder : `${withoutPlaceholder}${eol}${eol}[]`)
  updated = `${kept}${eol}`
} else {
  updated = `${withoutPlaceholder}${withoutPlaceholder.length > 0 ? `${eol}${eol}` : ''}${rows}${eol}`
}
if (!printOnly && updated !== original) writeFileSync(patchPath, updated)

console.log(`${remove ? 'removed' : 'linked'} ${plugins.length} plugin(s) ${remove ? 'from' : 'into'} ${profileDir}`)
if (!remove) {
  console.log(`  linked:    ${linked}${skipped > 0 ? `  (skipped ${skipped})` : ''}`)
}
console.log(`  patch:     ${patchPath}`)
console.log(`\nRestart the profile for the rows to load:  dsh --profile ${profileName} web`)

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
