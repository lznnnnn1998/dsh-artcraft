#!/usr/bin/env node
/**
 * Install a craft CLI for this machine — macOS, Windows or Linux.
 *
 * The craft plugins hold no binaries: the craft projects publish signed release
 * artifacts and this fetches the right one for the running platform. Everything
 * uses Node built-ins only, so a stock Windows or Linux box with no `unzip`,
 * `tar` or Rust toolchain works identically to a developer's Mac.
 *
 * Archives are large on Windows and Linux because those platforms have no
 * dedicated CLI bundle — the CLI ships inside the full application archive, and
 * only that one binary is extracted.
 *
 * Usage:
 *   node scripts/install-craft.mjs                 # every craft this platform supports
 *   node scripts/install-craft.mjs gridcraft       # one craft
 *   node scripts/install-craft.mjs --list          # what would be fetched
 *   node scripts/install-craft.mjs --dir DIR       # install somewhere else
 *   node scripts/install-craft.mjs --force         # reinstall even when present
 * @module scripts/install-craft
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromArchive } from './lib/archive.mjs'
import { downloadAsset, megabytes, resolveRelease } from './lib/craft-release.mjs'
import { buildCraftCli, findCargo, installBinary, looksLikeRepo, repoPath } from './lib/source-build.js'
import { defaultDshHome, isWindows, loadModule, parseArgv, readJson, rustInstallHint } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgv(process.argv.slice(2), ['--dir', '--repos'])
const listOnly = args.has('--list')
const force = args.has('--force')
/** `--from-source` compiles from a checkout instead of downloading a release. */
const fromSource = args.has('--from-source')
/** Where `--from-source` clones the craft repositories. */
const reposDir = resolve(args.value('--repos', join(root, 'repos')))
const requested = args.positionals

/**
 * Default install root: the harness home, beside the profiles, so the location
 * is stable no matter where the plugin package itself was unpacked.
 */
const installRoot = resolve(args.value('--dir')
  ?? process.env.DSH_ARTCRAFT_BIN_DIR
  ?? join(defaultDshHome(), 'crafts', 'bin'))

// `import()` needs a URL on Windows, where a bare `E:\…` path is read as the
// protocol `e:`; loadModule is the portable spelling.
const kit = await loadModule(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'index.js'))
const platform = await loadModule(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'platform.js'))

const profiles = requested.length > 0
  ? requested.map(id => kit.profileOf(id)).filter(Boolean)
  : kit.CRAFT_PROFILES

if (requested.length > 0 && profiles.length !== requested.length) {
  const known = kit.CRAFT_PROFILES.map(p => p.id)
  console.error(`unknown craft id(s): ${requested.filter(id => !known.includes(id)).join(', ')}`)
  console.error(`known: ${known.join(' ')}`)
  process.exit(2)
}

console.log(`platform: ${process.platform}/${process.arch}   install root: ${installRoot}`)

if (listOnly) {
  if (fromSource) {
    const cargo = findCargo()
    console.log(`  source mode: ${cargo === undefined ? 'Rust NOT installed' : cargo.version} | repos: ${reposDir}`)
    for (const profile of profiles) {
      console.log(`  ${profile.id.padEnd(14)} cargo build --release -p ${profile.id}-cli`)
    }
    process.exit(0)
  }
  for (const profile of profiles) {
    const target = platform.releaseTarget(profile.id)
    console.log(target === undefined
      ? `  ${profile.id.padEnd(14)} unsupported on ${process.platform}/${process.arch}`
      : `  ${profile.id.padEnd(14)} ${target.label.padEnd(22)} ${target.asset(profile.id, '<version>')}`)
  }
  process.exit(0)
}

if (fromSource) {
  const cargo = findCargo()
  if (cargo === undefined) {
    console.error('--from-source needs a Rust toolchain, and none was found.')
    console.error(`Install it with:  ${rustInstallHint()}`)
    console.error(isWindows
      ? 'Then re-open the shell (or add %USERPROFILE%\\.cargo\\bin to PATH) and run this again.'
      : 'Then re-open the shell (or add ~/.cargo/bin to PATH) and run this again.')
    console.error('Without Rust, omit --from-source to download the release binaries instead.')
    process.exit(2)
  }
  console.log(`source mode: ${cargo.version}`)
  console.log(`repos:       ${reposDir}`)
  mkdirSync(installRoot, { recursive: true })
  mkdirSync(reposDir, { recursive: true })

  const built = []
  for (const profile of profiles) {
    const dir = repoPath(reposDir, profile.id)
    if (!looksLikeRepo(dir)) {
      process.stdout.write(`${profile.id.padEnd(14)} cloning… `)
      try {
        execFileSync('git', ['clone', '--depth', '1', `https://github.com/storytold/${profile.id}.git`, dir], { stdio: 'pipe', timeout: 900_000 })
        console.log('ok')
      } catch (error) {
        console.log(`FAILED — ${String(error.stderr ?? error.message).slice(0, 200)}`)
        continue
      }
    }
    const binPath = join(installRoot, platform.binaryName(profile.id))
    const markerPath = join(installRoot, `${profile.id}.version.json`)
    if (!force && existsSync(binPath) && existsSync(markerPath)) {
      const marker = readJson(markerPath)
      if (marker.source === 'source') { console.log(`${profile.id.padEnd(14)} ${String(marker.version).padEnd(8)} already built`); continue }
    }
    process.stdout.write(`${profile.id.padEnd(14)} building… `)
    const result = buildCraftCli({ repoDir: dir, craft: profile.id, cargo })
    if (!result.ok) {
      console.log('FAILED')
      console.error(result.log.split('\n').slice(-8).map(line => `    ${line}`).join('\n'))
      continue
    }
    installBinary(result.binary, installRoot, platform.binaryName(profile.id))
    let version = 'source'
    try {
      version = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim().split('\n')[0]
    } catch { /* a CLI without --version still installs */ }
    writeFileSync(markerPath, JSON.stringify({ id: profile.id, version, source: 'source', repo: dir, builtAt: new Date().toISOString() }, undefined, 2) + '\n')
    console.log(`ok in ${result.seconds.toFixed(0)}s → ${binPath}`)
    built.push(profile.id)
  }
  console.log(`\nbuilt ${built.length} of ${profiles.length} craft CLI(s) from source`)
  if (built.length > 0) console.log(`The plugins find these automatically: ${installRoot}`)
  process.exit(built.length === profiles.length ? 0 : 1)
}

mkdirSync(installRoot, { recursive: true })
const installed = []
const skipped = []
for (const profile of profiles) {
  const target = platform.releaseTarget(profile.id)
  if (target === undefined) { console.log(`${profile.id.padEnd(14)} unsupported on ${process.platform}/${process.arch}`); continue }
  const binPath = join(installRoot, platform.binaryName(profile.id))
  const markerPath = join(installRoot, `${profile.id}.version.json`)
  if (!force && existsSync(binPath) && existsSync(markerPath)) {
    const marker = readJson(markerPath)
    skipped.push(profile.id)
    console.log(`${profile.id.padEnd(14)} ${String(marker.version).padEnd(8)} already installed`)
    continue
  }
  try {
    const { version, tag, asset } = await resolveRelease(profile.id, target)
    const archive = join(installRoot, `.download-${asset.name}`)
    process.stdout.write(`${profile.id.padEnd(14)} ${tag.padEnd(8)} downloading ${megabytes(asset.size)}… `)
    const bytes = await downloadAsset(profile.id, asset, archive, {
      onRetry: (attempt) => process.stdout.write(`retry ${attempt}… `),
    })
    const member = extractFromArchive(archive, join(installRoot, `.extract-${profile.id}`), target, profile.id)
    copyFileSync(member, binPath)
    // Windows has no execute bit; the archive is the executable as-is.
    if (!isWindows) chmodSync(binPath, 0o755)
    rmSync(archive, { force: true })
    rmSync(join(installRoot, `.extract-${profile.id}`), { recursive: true, force: true })
    writeFileSync(markerPath, JSON.stringify({ id: profile.id, version, tag, asset: asset.name, platform: process.platform, arch: process.arch }, undefined, 2) + '\n')
    console.log(`ok (${megabytes(bytes)}) → ${binPath}`)
    installed.push(profile.id)
  } catch (error) {
    console.log(`FAILED — ${error.message}`)
  }
}

console.log(`\ninstalled ${installed.length}, already present ${skipped.length}`)
if (installed.length > 0) {
  console.log(`The plugins find these automatically: ${installRoot}`)
}
