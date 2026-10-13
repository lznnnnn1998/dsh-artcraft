#!/usr/bin/env node
/**
 * Install the craft plugins into a DSH profile as proper bundles.
 *
 * A plugin only appears on the Web **Plugins** page when DSH can see it as an
 * installed bundle: a declared dependency of the profile whose `package.json`
 * carries `dsh.bundle.patch`. Rows written straight into `cordis.patch.yml`
 * load, but nothing owns them, so the page cannot list or toggle them.
 *
 * This packs each plugin, installs the tarball into the profile with pnpm, and
 * records it in `dsh.profile.bundles`. Everything DSH needs is the profile's own
 * package.json, so the result survives restarts and shows up in the UI.
 *
 * Usage:
 *   node scripts/install-into-profile.mjs                      # profile "web", home ~/.dsh
 *   node scripts/install-into-profile.mjs --profile web
 *   node scripts/install-into-profile.mjs --dry-run
 *   node scripts/install-into-profile.mjs --uninstall
 * @module scripts/install-into-profile
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')
const argv = process.argv.slice(2)
const flag = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const dryRun = argv.includes('--dry-run')
const uninstall = argv.includes('--uninstall')

const dshHome = resolve(flag('--dsh-home', process.env.DSH_HOME ?? join(homedir(), '.dsh')))
const profileName = flag('--profile', process.env.DSH_PROFILE ?? 'web')
const profileDir = join(dshHome, 'profiles', profileName)
const tarballDir = join(profileDir, '.artcraft-tarballs')

if (!existsSync(profileDir)) {
  console.error(`profile directory does not exist: ${profileDir}`)
  console.error('Create it first:  dsh plugin --profile ' + profileName + ' init')
  process.exit(2)
}

/** Plugin packages, in stable order. */
const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
  .map(entry => ({ dir: join(pluginsDir, entry.name), name: entry.name.replace(/^plugin-/, '') }))
  .filter(plugin => existsSync(join(plugin.dir, 'package.json')))
  .sort((a, b) => a.name.localeCompare(b.name))

const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const packageNames = plugins.map(plugin => JSON.parse(readFileSync(join(plugin.dir, 'package.json'), 'utf8')).name)

if (uninstall) {
  for (const name of packageNames) {
    delete manifest.dependencies[name]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== name)
  }
  if (!dryRun) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  console.log(`${dryRun ? 'would remove' : 'removed'} ${packageNames.length} plugin(s) from ${profileDir}`)
  if (!dryRun) console.log('run `pnpm install` in the profile to drop the packages, then restart the profile')
  process.exit(0)
}

mkdirSync(tarballDir, { recursive: true })

// 1. Pack every plugin. A `file:` dependency must be a tarball: pnpm will not
//    link a bare directory, and a tarball is also exactly what npm would hold.
const tarballs = []
for (const plugin of plugins) {
  const manifestForPlugin = JSON.parse(readFileSync(join(plugin.dir, 'package.json'), 'utf8'))
  process.stdout.write(`packing ${manifestForPlugin.name}… `)
  if (dryRun) { console.log('(dry run)'); tarballs.push({ name: manifestForPlugin.name, path: undefined }); continue }
  // `npm pack` honours `files`, so the tarball matches what would be published.
  const output = execFileSync('npm', ['pack', '--silent', '--pack-destination', tarballDir], {
    cwd: plugin.dir, encoding: 'utf8',
  })
  const file = output.trim().split('\n').pop()
  console.log(file)
  tarballs.push({ name: manifestForPlugin.name, path: join(tarballDir, file) })
}

// 2. Record them as profile dependencies and bundles.
for (const tarball of tarballs) {
  manifest.dependencies[tarball.name] = tarball.path === undefined ? 'file:…' : `file:${tarball.path}`
  if (!manifest.dsh.profile.bundles.includes(tarball.name)) manifest.dsh.profile.bundles.push(tarball.name)
}
if (!dryRun) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
console.log(`${dryRun ? 'would install' : 'installed'} ${tarballs.length} bundle(s) into ${profileDir}`)

if (dryRun) {
  console.log('\n--dry-run: nothing written')
  process.exit(0)
}

// 3. Let pnpm materialize node_modules so DSH can resolve each package.
process.stdout.write('installing packages with pnpm… ')
try {
  execFileSync('pnpm', ['install', '--silent'], { cwd: profileDir, stdio: 'pipe', timeout: 600_000 })
  console.log('ok')
} catch (error) {
  console.log('FAILED')
  console.error(String(error.stderr ?? error.message).slice(0, 800))
  process.exit(1)
}

console.log(`
Next:
  1. restart the profile:   dsh --profile ${profileName} web
  2. the plugins appear on the Web **Plugins** page, and the agent gains
     ${plugins.map(plugin => `${plugin.name}_run`).slice(0, 3).join(', ')}, … (${plugins.length} crafts)

The craft CLIs are separate — install them for this machine with:
  node scripts/install-craft.mjs
`)
