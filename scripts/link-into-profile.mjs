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
 * Both are satisfied by symlinking each plugin package into the profile's
 * `node_modules`; Node then walks up from the plugin's real path for its peers,
 * and the plugin's own `node_modules` (created by the workspace) wins first.
 * The profile's `cordis.patch.yml` is edited between marker comments, so
 * hand-written rows are never touched and re-running is idempotent.
 *
 * Usage:
 *   node scripts/link-into-profile.mjs                     # profile from $DSH_PROFILE_HOME or ~/.dsh
 *   node scripts/link-into-profile.mjs --profile web
 *   node scripts/link-into-profile.mjs --dsh-home /tmp/dsh-smoke --profile web
 *   node scripts/link-into-profile.mjs --remove
 *   node scripts/link-into-profile.mjs --print             # show the patch rows only
 * @module scripts/link-into-profile
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')

const BEGIN = '# >>> dsh-artcraft plugins (managed by scripts/link-into-profile.mjs) >>>'
const END = '# <<< dsh-artcraft plugins <<<'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
const remove = argv.includes('--remove')
const printOnly = argv.includes('--print')

const dshHome = resolve(flag('--dsh-home', process.env.DSH_HOME ?? join(homedir(), '.dsh')))
const profileName = flag('--profile', process.env.DSH_PROFILE ?? 'web')
const profileDir = join(dshHome, 'profiles', profileName)
const patchPath = join(profileDir, 'cordis.patch.yml')

/** Plugin packages present in the workspace, in stable order. */
function pluginPackages() {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
    .map(entry => ({ dir: join(pluginsDir, entry.name), craft: entry.name.slice('plugin-'.length) }))
    .filter(entry => existsSync(join(entry.dir, 'package.json')))
    .sort((a, b) => a.craft.localeCompare(b.craft))
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
    rows.push(`      name: "@dsh-artcraft/plugin-${plugin.craft}"`)
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

const nodeModules = join(profileDir, 'node_modules', '@dsh-artcraft')
mkdirSync(nodeModules, { recursive: true })

let linked = 0
for (const plugin of plugins) {
  const manifest = JSON.parse(readFileSync(join(plugin.dir, 'package.json'), 'utf8'))
  const target = join(nodeModules, manifest.name.split('/')[1])
  const desired = plugin.dir
  try {
    if (lstatSync(target).isSymbolicLink()) {
      if (remove) { rmSync(target); continue }
      const current = resolve(dirname(target), readFileSync('/dev/null', 'utf8') || '') // placeholder, replaced below
      void current
    } else if (existsSync(target)) {
      console.error(`refusing to replace a real directory: ${target}`)
      continue
    }
  } catch {
    // Does not exist yet.
  }
  rmSync(target, { force: true })
  if (remove) continue
  symlinkSync(desired, target, 'dir')
  linked += 1
}

// Rewrite only the managed block; every other line of the patch stays byte-identical.
const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '[]\n'
const withoutBlock = original
  .replace(new RegExp(`\\n?\\s*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`, 'g'), '\n')
  .trimEnd()

/**
 * A profile's `cordis.patch.yml` starts as a comment block plus `[]` — an
 * empty entry list. Rows cannot be appended to `[]`, so that placeholder is
 * dropped the first time this script writes the block, and restored when the
 * last managed row is removed. Any real entry the user wrote is preserved.
 */
const isPlaceholderOnly = (text) => text
  .split('\n')
  .every(line => line.trim() === '' || line.trim().startsWith('#') || line.trim() === '[]')

let updated
if (remove) {
  updated = (isPlaceholderOnly(withoutBlock) || withoutBlock.trim() === '')
    ? `${withoutBlock.trimEnd()}\n[\n]`.replace(/\[\n\]$/, '[]') + '\n'
    : `${withoutBlock}\n`
} else {
  const base = isPlaceholderOnly(withoutBlock) ? '' : withoutBlock
  updated = `${base.trimEnd()}${base.trim().length > 0 ? '\n\n' : ''}${patchRows()}\n`
}
if (!printOnly && updated !== original) writeFileSync(patchPath, updated)

console.log(`${remove ? 'removed' : 'linked'} ${plugins.length} plugin(s) ${remove ? 'from' : 'into'} ${profileDir}`)
if (!remove) console.log(`  symlinked: ${linked}`)
console.log(`  patch:     ${patchPath}`)
console.log(`\nRestart the profile for the rows to load:  dsh --profile ${profileName} web`)

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
