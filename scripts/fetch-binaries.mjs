#!/usr/bin/env node
/**
 * Fetch, unpack and install every ArtCraft CLI into the workspace's
 * `crafts-bin/`.
 *
 * `scripts/install-craft.mjs` is the recommended installer: it puts the CLIs
 * under the harness home, where every profile finds them. This one is the
 * workspace-local alternative — useful when you want the binaries beside the
 * checkout (a CI job, a container image, or several profiles sharing one copy).
 *
 * The craft repositories are never touched: this works entirely from the
 * published GitHub release artifacts, which is what makes the DSH plugins
 * runnable on a machine with no Rust toolchain.
 *
 * Windows is a first-class target: the archive for this platform is chosen from
 * the same table the plugins use, and it is unpacked by Node itself, so no
 * `unzip`, `xattr` or POSIX shell is involved.
 *
 * Usage:
 *   node scripts/fetch-binaries.mjs                 # every craft this platform supports
 *   node scripts/fetch-binaries.mjs gridcraft ...   # only the named crafts
 *   node scripts/fetch-binaries.mjs --list          # show what would be fetched
 *   node scripts/fetch-binaries.mjs --dir DIR       # install somewhere else
 *   node scripts/fetch-binaries.mjs --force         # reinstall over an existing copy
 * @module scripts/fetch-binaries
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromArchive } from './lib/archive.mjs'
import { downloadAsset, megabytes, resolveRelease } from './lib/craft-release.mjs'
import { isWindows, loadModule, parseArgv } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgv(process.argv.slice(2), ['--dir'])
const listOnly = args.has('--list')
const force = args.has('--force')
const requested = args.positionals

const installDir = resolve(args.value('--dir') ?? join(root, 'crafts-bin'))

// `profiles.mjs` is plain JavaScript so it loads with no build step; the
// platform table is generated, and is committed, so it is present in a clone.
const { CRAFT_PROFILES } = await loadModule(join(root, 'dsh-plugins', 'craft-kit', 'src', 'profiles.mjs'))
const platform = await loadModule(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'platform.js'))

/** Profiles that publish a runnable CLI release, in registry order. */
const releasable = CRAFT_PROFILES.filter((profile) => profile.release !== false)

if (requested.length > 0) {
  const known = new Set(releasable.map((profile) => profile.id))
  const unknown = requested.filter((id) => !known.has(id))
  if (unknown.length > 0) {
    console.error(`unknown craft id(s): ${unknown.join(', ')}`)
    console.error(`known: ${releasable.map((profile) => profile.id).join(' ')}`)
    process.exit(2)
  }
}

const profiles = requested.length > 0
  ? releasable.filter((profile) => requested.includes(profile.id))
  : releasable

console.log(`platform: ${process.platform}/${process.arch}   install root: ${installDir}`)

if (listOnly) {
  for (const profile of profiles) {
    const target = platform.releaseTarget(profile.id)
    console.log(target === undefined
      ? `  ${profile.id.padEnd(14)} unsupported on ${process.platform}/${process.arch}`
      : `  ${profile.id.padEnd(14)} ${target.label.padEnd(22)} ${target.asset(profile.id, '<version>')}`)
  }
  process.exit(0)
}

mkdirSync(installDir, { recursive: true })

/** The version marker written beside each installed binary. */
const versionsPath = join(installDir, 'VERSIONS.json')
const previous = new Map()
if (existsSync(versionsPath)) {
  try {
    for (const entry of readJson(versionsPath)) previous.set(entry.id, entry)
  } catch {
    // A malformed marker is not worth failing over; it is rewritten below.
  }
}

const results = []
const failed = []
for (const profile of profiles) {
  const target = platform.releaseTarget(profile.id)
  if (target === undefined) {
    console.log(`${profile.id.padEnd(14)} unsupported on ${process.platform}/${process.arch}`)
    continue
  }
  const fileName = platform.binaryName(profile.id)
  const installed = join(installDir, fileName)
  if (!force && existsSync(installed)) {
    const known = previous.get(profile.id)
    results.push(known ?? { id: profile.id, bin: fileName, version: '(present)' })
    console.log(`${profile.id.padEnd(14)} ${String(known?.tag ?? '').padEnd(10)} already present  → crafts-bin/${fileName}`)
    continue
  }
  try {
    const { version, tag, asset } = await resolveRelease(profile.id, target)
    const archive = join(installDir, `.download-${asset.name}`)
    process.stdout.write(`${profile.id.padEnd(14)} ${tag.padEnd(10)} downloading ${megabytes(asset.size)}… `)
    await downloadAsset(profile.id, asset, archive, {
      onRetry: (attempt) => process.stdout.write(`retry ${attempt}… `),
    })
    // Only the CLI member is extracted, so a 96 MB Windows application archive
    // never unpacks into the workspace.
    const scratch = join(installDir, `.extract-${profile.id}`)
    const member = extractFromArchive(archive, scratch, target, profile.id)
    rmSync(installed, { force: true })
    copyFileSync(member, installed)
    if (!isWindows) chmodSync(installed, 0o755)
    rmSync(archive, { force: true })
    rmSync(scratch, { recursive: true, force: true })
    const bytes = statSync(installed).size
    console.log(`ok → crafts-bin/${fileName}  ${version}  (${megabytes(bytes)})`)
    results.push({ id: profile.id, tag, bin: fileName, version })
  } catch (error) {
    failed.push(profile.id)
    console.log(`FAILED — ${error.message}`)
  }
}

writeFileSync(versionsPath, JSON.stringify(results, undefined, 2) + '\n')
console.log(`\ninstalled ${results.length}/${profiles.length} craft CLI(s) into ${basename(installDir)}/`)
if (failed.length > 0) {
  console.error(`failed: ${failed.join(', ')}`)
  process.exitCode = 1
}
if (results.length > 0) {
  console.log('The plugins search crafts-bin/ beside the workspace, so no configuration is needed.')
}
