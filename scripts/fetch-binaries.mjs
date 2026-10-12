#!/usr/bin/env node
/**
 * Fetch, unpack and install every ArtCraft CLI into `crafts-bin/`.
 *
 * The craft repositories are never touched: this works entirely from the
 * published GitHub release assets, which is what makes the DSH plugins
 * runnable on a machine with no Rust toolchain.
 *
 * Usage:
 *   node scripts/fetch-binaries.mjs                 # every profile in index.mjs
 *   node scripts/fetch-binaries.mjs gridcraft ...   # only the named crafts
 *   node scripts/fetch-binaries.mjs --list          # show what would be fetched
 * @module scripts/fetch-binaries
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const downloadDir = join(root, 'bin', 'dl')
const unpackDir = join(root, 'bin', 'unpacked')
const installDir = join(root, 'crafts-bin')

const { CRAFT_PROFILES } = await import('../dsh-plugins/craft-kit/src/profiles.mjs')

const argv = process.argv.slice(2)
const listOnly = argv.includes('--list')
const requested = argv.filter(arg => !arg.startsWith('--'))
const profiles = requested.length > 0
  ? CRAFT_PROFILES.filter(p => requested.includes(p.id))
  : CRAFT_PROFILES.filter(p => p.release !== false)

if (requested.length > 0 && profiles.length !== requested.length) {
  const known = new Set(CRAFT_PROFILES.map(p => p.id))
  const unknown = requested.filter(id => !known.has(id))
  console.error(`unknown craft id(s): ${unknown.join(', ')}`)
  process.exit(2)
}

mkdirSync(downloadDir, { recursive: true })
mkdirSync(unpackDir, { recursive: true })
mkdirSync(installDir, { recursive: true })

/** Ask the GitHub API for the newest macOS CLI asset of one craft. */
async function latestMacCli(repo, bin) {
  const response = await fetch(`https://api.github.com/repos/storytold/${repo}/releases/latest`, {
    headers: { 'user-agent': 'dsh-artcraft-plugins', accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${repo}`)
  const release = await response.json()
  const asset = (release.assets ?? []).find(candidate =>
    candidate.name.startsWith(`${bin}-`) && candidate.name.includes('macos') && candidate.name.endsWith('.zip'))
  if (asset === undefined) throw new Error(`${repo}@${release.tag_name} has no macOS CLI zip`)
  return { tag: release.tag_name, name: asset.name, url: asset.browser_download_url, size: asset.size }
}

/** Download when absent, then unpack and install the CLI. */
async function install(profile) {
  const asset = await latestMacCli(profile.id, profile.bin)
  const zip = join(downloadDir, asset.name)
  if (!existsSync(zip) || statSync(zip).size !== asset.size) {
    process.stdout.write(`downloading ${profile.id} ${asset.tag} (${(asset.size / 1e6).toFixed(1)} MB)… `)
    const response = await fetch(asset.url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`download ${response.status} for ${asset.url}`)
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()))
    console.log('ok')
  }
  const target = join(unpackDir, profile.id)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  execFileSync('unzip', ['-o', '-q', zip, '-d', target])
  const binary = findBinary(target, profile.bin)
  if (binary === undefined) throw new Error(`${asset.name}: no ${profile.bin} inside`)
  const installed = join(installDir, profile.bin)
  rmSync(installed, { force: true })
  copyFileSync(binary, installed)
  chmodSync(installed, 0o755)
  // macOS quarantines downloaded executables; the plugins exec them directly.
  try { execFileSync('xattr', ['-d', 'com.apple.quarantine', installed], { stdio: 'ignore' }) } catch { /* not quarantined */ }
  let version
  try {
    version = execFileSync(installed, ['--version'], { encoding: 'utf8', timeout: 8000 }).trim().split('\n')[0]
  } catch { version = '(no --version)' }
  console.log(`${profile.id.padEnd(14)} ${asset.tag.padEnd(10)} -> crafts-bin/${profile.bin}  ${version}`)
  return { id: profile.id, tag: asset.tag, bin: profile.bin, version }
}

/** Depth-first search for the first executable file named `bin`. */
function findBinary(dir, bin) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { const nested = findBinary(full, bin); if (nested !== undefined) return nested; continue }
    if (entry.name === bin && (statSync(full).mode & 0o111) !== 0) return full
  }
  return undefined
}

if (listOnly) {
  for (const profile of profiles) console.log(`${profile.id.padEnd(14)} ${profile.bin}`)
  process.exit(0)
}

const results = []
for (const profile of profiles) {
  try {
    results.push(await install(profile))
  } catch (error) {
    console.error(`${profile.id}: ${error.message}`)
  }
}
console.log(`\ninstalled ${results.length}/${profiles.length} craft CLIs into ${basename(installDir)}/`)
writeFileSync(join(installDir, 'VERSIONS.json'), JSON.stringify(results, undefined, 2) + '\n')
