#!/usr/bin/env node
/**
 * Install the craft plugins into a DSH profile as proper bundles.
 *
 * A plugin only appears on the Web **Plugins** page when DSH can see it as an
 * installed bundle: a declared dependency of the profile whose `package.json`
 * carries `dsh.bundle.patch`. Rows written straight into `cordis.patch.yml`
 * load, but nothing owns them, so the page cannot list or toggle them.
 *
 * This packs each plugin, installs the tarball into the profile with the
 * package manager the harness itself ships (pnpm), and records it in
 * `dsh.profile.bundles`. Everything DSH needs is the profile's own
 * package.json, so the result survives restarts and shows up in the UI.
 *
 * Nothing here needs `npm` or `pnpm` on `PATH`: on Windows both are `.cmd`
 * shims that Node refuses to spawn, so the bundled `pnpm.mjs` is preferred and
 * run through the same Node executable.
 *
 * Usage:
 *   node scripts/install-into-profile.mjs                      # profile "web", home ~/.dsh
 *   node scripts/install-into-profile.mjs --profile web
 *   node scripts/install-into-profile.mjs --dry-run
 *   node scripts/install-into-profile.mjs --uninstall
 * @module scripts/install-into-profile
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultDshHome, packageManager, parseArgv, PM_ENV, readJson, runPackageManager } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')
const args = parseArgv(process.argv.slice(2), ['--profile', '--dsh-home'])
const dryRun = args.has('--dry-run')
const uninstall = args.has('--uninstall')

const dshHome = resolve(args.value('--dsh-home', defaultDshHome()))

/**
 * The profile to install into when `--profile` is not given.
 *
 * `web` was once the only profile a DSH install created, so it was a safe
 * default. A desktop install creates `desktop` instead, and hard-coding `web`
 * there fails with a confusing "profile directory does not exist", so a single
 * existing profile is adopted, `web` wins when both exist, and the choice is
 * always reported.
 * @returns the profile name, and where it came from.
 */
function chooseProfile() {
  const explicit = args.value('--profile', process.env.DSH_PROFILE)
  if (explicit !== undefined && explicit.length > 0) return { name: explicit, source: 'as requested' }
  const profilesDir = join(dshHome, 'profiles')
  let available = []
  try {
    available = readdirSync(profilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    // No profiles directory: fall through to the default and let the
    // existence check below explain what is missing.
  }
  if (available.includes('web')) return { name: 'web', source: 'default' }
  if (available.length === 1) return { name: available[0], source: `only profile in ${profilesDir}` }
  return { name: 'web', source: 'default' }
}

const chosen = chooseProfile()
const profileName = chosen.name
const profileDir = join(dshHome, 'profiles', profileName)
const tarballDir = join(profileDir, '.artcraft-tarballs')

if (!existsSync(profileDir)) {
  console.error(`profile directory does not exist: ${profileDir}`)
  const profilesDir = join(dshHome, 'profiles')
  if (existsSync(profilesDir)) {
    const available = readdirSync(profilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
    console.error(available.length > 0 ? `available profiles: ${available.join(', ')}` : 'no profiles found')
    console.error(`Install into one of them:  node scripts/install-into-profile.mjs --profile ${available[0] ?? '<name>'}`)
  } else {
    console.error('Create it first:  dsh plugin --profile ' + profileName + ' init')
  }
  process.exit(2)
}

console.log(`profile: ${profileName}  (${chosen.source})   home: ${dshHome}`)

/**
 * A `file:` dependency value the profile can resolve on any platform.
 *
 * `file:C:\Users\…\x.tgz` is ambiguous — a package manager splits on the drive
 * colon as if it were a URL scheme — so the path is written with forward
 * slashes, which npm, pnpm and yarn all accept on Windows too.
 * @param path - absolute path to the tarball.
 * @returns a `file:` specifier with POSIX separators.
 */
function fileSpecifier(path) {
  return `file:${path.split(sep).join('/')}`
}

/** Plugin packages, in stable order. */
const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
  .map(entry => ({ dir: join(pluginsDir, entry.name), name: entry.name.replace(/^plugin-/, '') }))
  .filter(plugin => existsSync(join(plugin.dir, 'package.json')))
  .sort((a, b) => a.name.localeCompare(b.name))

const manifestPath = join(profileDir, 'package.json')
// A profile created by `dsh plugin init` always has one, but a hand-made
// directory should be adopted rather than crash the installer.
const manifest = existsSync(manifestPath)
  ? readJson(manifestPath)
  : { name: `dsh-profile-${profileName}`, private: true, version: '0.0.0' }
manifest.dependencies ??= {}
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

const packageNames = plugins.map(plugin => readJson(join(plugin.dir, 'package.json')).name)

if (uninstall) {
  for (const name of packageNames) {
    delete manifest.dependencies[name]
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== name)
  }
  if (!dryRun) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  console.log(`${dryRun ? 'would remove' : 'removed'} ${packageNames.length} plugin(s) from ${profileDir}`)
  if (!dryRun) console.log('run the package manager in the profile to drop the packages, then restart the profile')
  process.exit(0)
}

// Resolve the installer before doing any work, so a machine with no usable
// package manager fails with guidance instead of an ENOENT mid-install. On
// Windows this is the difference between working and not: `npm` and `pnpm` are
// `.cmd` shims there, and Node cannot spawn one without a shell.
const pm = dryRun ? undefined : packageManager()
if (pm !== undefined) console.log(`package manager: ${pm.label}  (${pm.source})`)

// A stale tarball from an earlier version would otherwise be picked up by the
// directory fallback below.
if (!dryRun) rmSync(tarballDir, { recursive: true, force: true })
mkdirSync(tarballDir, { recursive: true })

/**
 * Pack one plugin so the profile can install it as a real dependency.
 *
 * `npm pack` honours `files`, and so does `pnpm pack`, which matters because
 * pnpm is the one manager guaranteed to be present — the harness ships it.
 * @param pm - the resolved package manager.
 * @param plugin - the plugin directory.
 * @param pluginManifest - its parsed `package.json`.
 * @returns the absolute path of the tarball written.
 */
function packPlugin(pm, plugin, pluginManifest) {
  let output
  try {
    output = runPackageManager(pm, ['pack', '--pack-destination', tarballDir], {
      cwd: plugin.dir, encoding: 'utf8', timeout: 300_000,
    })
  } catch (error) {
    throw new Error(`${String(error.stderr ?? error.message).trim().slice(0, 400)}`)
  }
  // pnpm ends a tarball report with the absolute path; npm prints a bare
  // filename. Accept either, then fall back to whatever appeared on disk.
  const lines = String(output).split('\n').map(line => line.trim()).filter(line => line.length > 0)
  for (const line of lines.reverse()) {
    if (!line.endsWith('.tgz')) continue
    if (existsSync(line)) return resolve(line)
    const inDir = join(tarballDir, line)
    if (existsSync(inDir)) return inDir
  }
  const produced = readdirSync(tarballDir)
    .filter(file => file.endsWith('.tgz') && file.startsWith(`${pluginManifest.name}-`))
    .sort()
  if (produced.length === 0) throw new Error('the package manager produced no tarball')
  return join(tarballDir, produced[produced.length - 1])
}

// 1. Pack every plugin. A `file:` dependency must be a tarball: pnpm will not
//    link a bare directory, and a tarball is also exactly what npm would hold.
const tarballs = []
for (const plugin of plugins) {
  const manifestForPlugin = readJson(join(plugin.dir, 'package.json'))
  process.stdout.write(`packing ${manifestForPlugin.name}… `)
  if (dryRun) { console.log('(dry run)'); tarballs.push({ name: manifestForPlugin.name, path: undefined }); continue }
  const tarball = packPlugin(pm, plugin, manifestForPlugin)
  console.log(tarball.slice(tarballDir.length + 1))
  tarballs.push({ name: manifestForPlugin.name, path: tarball })
}

// 2. Record them as profile dependencies and bundles.
for (const tarball of tarballs) {
  manifest.dependencies[tarball.name] = tarball.path === undefined ? 'file:…' : fileSpecifier(tarball.path)
  if (!manifest.dsh.profile.bundles.includes(tarball.name)) manifest.dsh.profile.bundles.push(tarball.name)
}
if (!dryRun) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
console.log(`${dryRun ? 'would install' : 'installed'} ${tarballs.length} bundle(s) into ${profileDir}`)

if (dryRun) {
  console.log('\n--dry-run: nothing written')
  process.exit(0)
}

// 3. Let the package manager materialize node_modules so DSH can resolve each package.
process.stdout.write(`installing packages with ${pm.label}… `)
try {
  runPackageManager(pm, ['install', '--silent'], { cwd: profileDir, stdio: 'pipe', timeout: 900_000 })
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

Set ${PM_ENV} to choose the package manager used here.
`)
