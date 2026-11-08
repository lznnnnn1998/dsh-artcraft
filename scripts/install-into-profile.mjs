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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defaultDshHome, packageManager, parseArgv, PM_ENV, readJson, runPackageManager } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')
const args = parseArgv(process.argv.slice(2), ['--profile', '--dsh-home'])
const dryRun = args.has('--dry-run')
const uninstall = args.has('--uninstall')
const force = args.has('--force')

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
// Every directory under dsh-plugins/ that declares a `dsh.bundle` is a bundle:
// the fourteen craft plugins (`plugin-<craft>`) and the preview panel
// (`preview-panel`) are installed the same way. Selecting by the manifest rather
// than by a name prefix is what keeps a new package from silently not shipping.
const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({ dir: join(pluginsDir, entry.name), name: entry.name.replace(/^plugin-/, '') }))
  .filter((plugin) => {
    const manifest = join(plugin.dir, 'package.json')
    if (!existsSync(manifest)) return false
    try {
      return readJson(manifest).dsh?.bundle?.patch !== undefined
    } catch {
      return false
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// ── preflight ────────────────────────────────────────────────────────────────
// Everything below this line answers questions before touching the profile:
// which DSH is running, what is already installed at which version, what the
// repository ships, and which of those disagree. The install then executes a
// decided plan instead of blindly repacking fifteen packages.

const require = createRequire(import.meta.url)

/** The version installed in this profile, or `undefined`. */
function installedVersion(name) {
  try {
    return readJson(join(profileDir, 'node_modules', name, 'package.json')).version
  } catch {
    return undefined
  }
}

/** Compare dotted versions; a prerelease sorts before its release. */
function compareVersions(a, b) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value))
    return match === null ? [0, 0, 0, ''] : [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? '']
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  if (left[3] === right[3]) return 0
  if (left[3] === '') return 1
  if (right[3] === '') return -1
  return left[3] < right[3] ? -1 : 1
}

/** The DSH version this profile will boot with. */
function dshRuntimeVersion() {
  const candidates = [
    join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'),
    join(root, '..', 'deepseek-harness', 'packages', 'boot', 'app-boot', 'package.json'),
    join(process.env.HOME ?? process.env.USERPROFILE ?? '', 'deepseek-harness', 'packages', 'boot', 'app-boot', 'package.json'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      return readJson(candidate).version
    } catch {
      // Keep looking; a damaged manifest is not a reason to fail here.
    }
  }
  return undefined
}

/**
 * Whether a version satisfies an `engines.dsh` range.
 *
 * `semver` is used when the profile or a harness checkout provides it. The
 * fallback covers the one shape this repository ships (`^x.y.z`), and an
 * unrecognised range never blocks an install: refusing on a range this script
 * cannot read would be worse than letting app-boot judge it at boot.
 */
function satisfies(version, range) {
  const semverDirs = [
    join(profileDir, 'node_modules', 'semver'),
    join(root, '..', 'deepseek-harness', 'node_modules', 'semver'),
  ]
  for (const dir of semverDirs) {
    if (!existsSync(dir)) continue
    try {
      const semver = require(dir)
      return semver.satisfies(version, range, { includePrerelease: true })
    } catch {
      break
    }
  }
  const caret = /^\^(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (caret === null) return true
  const parsed = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (parsed === null) return false
  const [major, minor, patch] = caret.slice(1).map(Number)
  const [haveMajor, haveMinor, havePatch] = parsed.slice(1).map(Number)
  if (haveMajor !== major) return false
  if (major > 0) return true
  if (haveMinor !== minor) return false
  return havePatch >= patch
}

const runtimeVersion = dshRuntimeVersion()

/** One row of the plan. */
const planned = []
const skipped = []
const problems = []
const notes = []

for (const plugin of plugins) {
  const pluginManifest = readJson(join(plugin.dir, 'package.json'))
  const name = pluginManifest.name
  const version = pluginManifest.version
  const label = `${name}@${version}`
  const range = pluginManifest.engines?.dsh

  if (typeof range === 'string' && runtimeVersion !== undefined && !satisfies(runtimeVersion, range)) {
    problems.push(`${label} requires dsh ${range}; this profile boots dsh ${runtimeVersion} (app-boot would refuse it)`)
    continue
  }

  const current = installedVersion(name)
  if (current === undefined) {
    planned.push({ ...plugin, pluginManifest, current, action: 'install' })
  } else if (force) {
    planned.push({ ...plugin, pluginManifest, current, action: 'reinstall' })
  } else if (current === version) {
    skipped.push(`${name}@${current} is current`)
  } else if (compareVersions(version, current) > 0) {
    planned.push({ ...plugin, pluginManifest, current, action: 'upgrade' })
  } else {
    skipped.push(`${name}@${current} is newer than this checkout (${version}); --force downgrades`)
  }
}

// A `file:` dependency must point at a tarball that still exists: the pack
// directory is scratch space, and an earlier run (or a manual cleanup) may have
// removed a tarball for a package that is otherwise up to date. Skipping it
// would leave pnpm with a dependency it cannot resolve.
const diskDependencies = (() => {
  try {
    return readJson(join(profileDir, 'package.json')).dependencies ?? {}
  } catch {
    return {}
  }
})()
for (let index = skipped.length - 1; index >= 0; index -= 1) {
  const name = skipped[index].split('@')[0]
  const spec = diskDependencies[name]
  if (typeof spec !== 'string' || !spec.startsWith('file:')) continue
  if (existsSync(spec.slice('file:'.length))) continue
  const plugin = plugins.find(candidate => readJson(join(candidate.dir, 'package.json')).name === name)
  if (plugin === undefined) continue
  const pluginManifest = readJson(join(plugin.dir, 'package.json'))
  planned.push({ ...plugin, pluginManifest, current: installedVersion(name), action: 'restore' })
  skipped.splice(index, 1)
}

const desiredNames = new Set(plugins.map(plugin => readJson(join(plugin.dir, 'package.json')).name))

// Packages this profile has that this checkout no longer ships (renamed or
// dropped). Leaving them makes two copies of one row fight at boot.
const leftovers = existsSync(join(profileDir, 'node_modules'))
  ? readdirSync(join(profileDir, 'node_modules'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-artcraft') && !desiredNames.has(entry.name))
    .map(entry => entry.name)
  : []

// A profile patch file with hand-written artcraft rows duplicates the bundle
// rows: the plugin loads twice or the row is owned by nobody.
const profilePatch = join(profileDir, 'cordis.patch.yml')
if (existsSync(profilePatch)) {
  const rows = [...readFileSync(profilePatch, 'utf8').matchAll(/^\s*-?\s*id:\s*(artcraft[\w-]*)/gm)].map(match => match[1])
  if (rows.length > 0) notes.push(`profile cordis.patch.yml has ${rows.length} hand-written artcraft row(s) (${rows.slice(0, 3).join(', ')}): remove them, the bundle rows already load these plugins`)
}

// Duplicate entries in the bundle list are harmless at boot but confusing in
// the UI; the rewrite below dedupes. Read from disk here: the in-memory
// manifest is created after this preflight.
const diskBundles = (() => {
  try {
    return readJson(join(profileDir, 'package.json')).dsh?.profile?.bundles ?? []
  } catch {
    return []
  }
})()
const bundleDuplicates = diskBundles.filter((entry, index, list) => list.indexOf(entry) !== index)

const header = `profile: ${profileName}  (${chosen.source})   home: ${dshHome}`
console.log(header)
console.log(`dsh runtime: ${runtimeVersion ?? 'unknown (no checkout or profile app-boot found)'}   checkout: ${resolve(root)}`)

if (problems.length > 0) {
  console.error('\nIncompatible with this DSH:')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error('\nNothing was changed. Update the plugins or upgrade/downgrade DSH, then retry.')
  process.exit(1)
}

console.log('\nPlan:')
for (const action of planned) {
  const line = action.current === undefined
    ? `install   ${action.pluginManifest.name}@${action.pluginManifest.version}`
    : action.action === 'restore'
      ? `restore   ${action.pluginManifest.name}@${action.pluginManifest.version} (its tarball was cleaned)`
      : `${action.action === 'upgrade' ? 'upgrade  ' : 'reinstall'} ${action.pluginManifest.name}  ${action.current} → ${action.pluginManifest.version}`
  console.log(`  ${line}`)
}
for (const skip of skipped) console.log(`  skip      ${skip}`)
for (const leftover of leftovers) console.log(`  remove    ${leftover} (no longer shipped by this checkout)`)
if (bundleDuplicates.length > 0) console.log(`  dedupe    ${bundleDuplicates.length} duplicate bundle entr${bundleDuplicates.length === 1 ? 'y' : 'ies'}`)
for (const note of notes) console.log(`  warn      ${note}`)

if (planned.length === 0 && leftovers.length === 0 && !uninstall) {
  console.log('\nEverything is up to date; nothing to install.')
}

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
  if (!dryRun) {
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    // The manifest alone leaves the packages on disk; removing them makes the
    // uninstall real and a later install start from a known state.
    for (const name of [...packageNames, ...leftovers]) {
      rmSync(join(profileDir, 'node_modules', name), { recursive: true, force: true })
    }
  }
  console.log(`${dryRun ? 'would remove' : 'removed'} ${packageNames.length} bundle(s) and their packages from ${profileDir}`)
  if (!dryRun) {
    console.log('Restart the profile. If the preview panel was installed, its server may still be')
    console.log('listening on 127.0.0.1:4177 — stop that process to free the port.')
  }
  process.exit(0)
}

// ── output the plan and stop when there is nothing to do ─────────────────────
// Leftovers and duplicate rows are corrected even when every version matches:
// they are the residue of earlier installs, not a new install.
if (!dryRun) {
  // A Windows antivirus or the indexer can hold a just-removed directory open;
  // failing the whole install over a leftover is worse than leaving it for next time.
  for (const leftover of leftovers) {
    try { rmSync(join(profileDir, 'node_modules', leftover), { recursive: true, force: true }) } catch { /* retried next run */ }
  }
  if (bundleDuplicates.length > 0) manifest.dsh.profile.bundles = [...new Set(manifest.dsh.profile.bundles)]
  if (leftovers.length > 0 || bundleDuplicates.length > 0) {
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

if (dryRun) {
  console.log('\n--dry-run: nothing written')
  process.exit(0)
}

// from here the plan is authoritative: an empty plan means nothing to pack
const pm = planned.length === 0 ? undefined : packageManager()
const packPm = planned.length === 0 ? undefined : packageManager(['npm'])
if (pm !== undefined) {
  console.log(`package manager: ${pm.label}  (${pm.source})`)
  if (packPm.source !== pm.source) console.log(`packing with:    ${packPm.label}  (${packPm.source})`)
}

// Installing into a profile is pnpm's job — the profile is a pnpm workspace and
// DSH manages it that way — while *packing* is an npm operation. On a machine
// that has npm (macOS, Linux) packing goes through npm; on Windows, which has
// none, both fall back to the pnpm the harness ships, so neither step depends on
// npm existing.
// The pack directory is kept: packages skipped as current still point at the
// tarball recorded in the profile. Old ones are pruned after a successful
// install, never before.
if (planned.length > 0) mkdirSync(tarballDir, { recursive: true })

/**
 * Pack one plugin so the profile can install it as a real dependency.
 *
 * Both managers honour `files`, so the tarball matches what would be published.
 * `--silent` is added only for npm, which is what the original command used;
 * pnpm's report is parsed as-is rather than relying on either output format.
 * @param manager - the package manager to pack with.
 * @param plugin - the plugin directory.
 * @param pluginManifest - its parsed `package.json`.
 * @returns the absolute path of the tarball written.
 */
function packPlugin(manager, plugin, pluginManifest) {
  const args = ['pack', '--pack-destination', tarballDir]
  if (manager.kind === 'npm') args.splice(1, 0, '--silent')
  let output
  try {
    output = runPackageManager(manager, args, {
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

if (planned.length > 0) {
  // 1. Pack the packages that are not already current. A `file:` dependency
  //    must be a tarball: pnpm will not link a bare directory, and a tarball is
  //    also exactly what npm would hold.
  const tarballs = []
  for (const plugin of planned) {
    const manifestForPlugin = plugin.pluginManifest
    process.stdout.write(`packing ${manifestForPlugin.name}… `)
    const tarball = packPlugin(packPm, plugin, manifestForPlugin)
    console.log(tarball.slice(tarballDir.length + 1))
    tarballs.push({ name: manifestForPlugin.name, path: tarball })
  }

  // 2. Record them as profile dependencies and bundles.
  for (const tarball of tarballs) {
    manifest.dependencies[tarball.name] = fileSpecifier(tarball.path)
    if (!manifest.dsh.profile.bundles.includes(tarball.name)) manifest.dsh.profile.bundles.push(tarball.name)
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  console.log(`installed ${tarballs.length} bundle(s) into ${profileDir}`)

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

  // Prune tarballs for versions the profile no longer references.
  const referenced = new Set(Object.values(manifest.dependencies)
    .filter(value => typeof value === 'string' && value.startsWith('file:'))
    .map(value => resolve(value.slice('file:'.length))))
  for (const file of readdirSync(tarballDir)) {
    const absolute = join(tarballDir, file)
    if (referenced.has(absolute)) continue
    try { rmSync(absolute, { force: true }) } catch { /* a lock retries next run */ }
  }
}

// 4. Agent skills live in their own repository (dsh-artcraft-skills). Install
// them when a checkout is beside this one, or when --skills-dir names one: the
// plugin repository ships capability, the skills repository ships the method.
const skillsRoot = (() => {
  const explicit = args.value('--skills-dir')
  if (explicit !== undefined) return resolve(explicit)
  const sibling = join(root, '..', 'dsh-artcraft-skills', 'skills')
  if (existsSync(join(sibling, 'artcraft', 'SKILL.md'))) return sibling
  return undefined
})()

if (skillsRoot === undefined) {
  console.log('no skills directory: clone lznnnnn1998/dsh-artcraft-skills beside this repository, or pass --skills-dir')
} else if (existsSync(skillsRoot)) {
  const installed = []
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const source = join(skillsRoot, entry.name)
    if (!existsSync(join(source, 'SKILL.md'))) continue
    const target = join(dshHome, 'skills', entry.name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
    installed.push(entry.name)
  }
  console.log(`installed ${installed.length} skill(s) from ${skillsRoot}: ${installed.join(', ')}`)
}

// 5. Advice: the workflows these plugins take part in usually need partners.
try {
  const suite = await import(pathToFileURL(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'suite.js')).href)
  const installedCrafts = plugins.map(plugin => plugin.name.replace(/^craft-/, ''))
  const suggestions = suite.suggestCrafts(installedCrafts)
  if (suggestions.length > 0) {
    console.log('\nThese workflows are one plugin short:')
    for (const suggestion of suggestions.slice(0, 5)) {
      console.log(`  ${suggestion.craft.padEnd(14)} completes "${suggestion.forWorkflow}" (${suggestion.delivers})`)
    }
    console.log(`  install:  dsh plugin --profile ${profileName} add ${suggestions.slice(0, 3).map(s => `dsh-artcraft-plugin-${s.craft}`).join(' ')}`)
  }
  console.log(`  companions: dsh-artcraft-preview-panel (live preview) and dsh-artcraft-skills (the workflows)`)
} catch {
  // Advice is a convenience; an unbuilt kernel must not fail the install.
}

const craftCount = plugins.filter(plugin => plugin.name !== 'preview-panel').length
const cliName = (craft) => process.platform === 'win32' ? `${craft}-cli.exe` : `${craft}-cli`
const allClisPresent = plugins
  .filter(plugin => plugin.name !== 'preview-panel')
  .every(plugin => existsSync(join(dshHome, 'crafts', 'bin', cliName(plugin.name))))

console.log(`
Next:
  1. restart the profile:   dsh --profile ${profileName} web
  2. the plugins appear on the Web **Plugins** page, and the agent gains
     ${plugins.map(plugin => `${plugin.name}_run`).slice(0, 3).join(', ')}, … (${craftCount} crafts${plugins.length > craftCount ? ' and the preview panel' : ''})

${allClisPresent ? 'All fourteen craft CLIs are already installed for this machine.' : `The craft CLIs are separate — install them for this machine with:
  node scripts/install-craft.mjs`}

Set ${PM_ENV} to choose the package manager used here.
`)
