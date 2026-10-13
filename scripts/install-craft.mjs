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

import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromArchive } from './lib/archive.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
const listOnly = argv.includes('--list')
const force = argv.includes('--force')
const requested = argv.filter(a => !a.startsWith('--') && !(argv[argv.indexOf(a) - 1] ?? '').startsWith('--'))

/**
 * Default install root: the harness home, beside the profiles, so the location
 * is stable no matter where the plugin package itself was unpacked.
 */
const installRoot = resolve(flag('--dir')
  ?? process.env.DSH_ARTCRAFT_BIN_DIR
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'crafts', 'bin'))

const kit = await import(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'index.js'))
const platform = await import(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'platform.js'))

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

/** Ask the GitHub API for the newest release and its matching asset. */
async function findAsset(id, target) {
  const headers = { 'user-agent': 'dsh-artcraft', accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN !== undefined) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const releaseResponse = await fetch(`https://api.github.com/repos/storytold/${id}/releases/latest`, { headers })
  if (!releaseResponse.ok) throw new Error(`GitHub API ${releaseResponse.status}`)
  const release = await releaseResponse.json()
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const wanted = target.asset(id, version)
  if (wanted === undefined) throw new Error(`no ${target.label} asset naming rule for ${id}`)
  const asset = (release.assets ?? []).find(candidate => candidate.name === wanted)
  if (asset === undefined) {
    const available = (release.assets ?? []).map(a => a.name).filter(n => target.container === 'zip' ? n.endsWith('.zip') : n.endsWith('.tar.gz'))
    throw new Error(`asset ${wanted} not in ${release.tag_name}. Available archives: ${available.slice(0, 4).join(', ') || '(none)'}`)
  }
  return { version, tag: release.tag_name, asset }
}

/**
 * Download through the API endpoint, which redirects to a signed CDN URL.
 *
 * The asset endpoint also works when `github.com` itself is unreachable, and
 * streaming to a file keeps a 20 MB Windows archive out of memory. A CDN drop
 * mid-transfer is the most common failure on a slow link, so each attempt
 * restarts from zero and a short size check decides whether it completed.
 * @param id - craft id (the repository name).
 * @param asset - the release asset to fetch.
 * @param destination - file to write.
 * @returns the number of bytes written.
 */
async function download(id, asset, destination, attempts = 3) {
  const headers = { accept: 'application/octet-stream', 'user-agent': 'dsh-artcraft' }
  if (process.env.GITHUB_TOKEN !== undefined) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const url = `https://api.github.com/repos/storytold/${id}/releases/assets/${asset.id}`
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    rmSync(destination, { force: true })
    try {
      const response = await fetch(url, { headers, redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
      const size = statSync(destination).size
      if (size !== asset.size) throw new Error(`truncated: ${size} of ${asset.size} bytes`)
      return size
    } catch (error) {
      lastError = error
      if (attempt < attempts) process.stdout.write(`retry ${attempt}… `)
    }
  }
  // Fall back to the platform's own client, which handles proxies, certificate
  // stores and slow CDN links differently from Node's fetch.
  try {
    rmSync(destination, { force: true })
    const args = ['-sSL', '--retry', '3', '--retry-all-errors', '--fail', '-o', destination]
    if (process.env.GITHUB_TOKEN !== undefined) args.push('-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`)
    args.push('-H', 'Accept: application/octet-stream', url)
    execFileSync('curl', args, { stdio: 'ignore', timeout: 900_000 })
    const size = statSync(destination).size
    if (size !== asset.size) throw new Error(`truncated via curl: ${size} of ${asset.size} bytes`)
    return size
  } catch (error) {
    throw new Error(`${lastError?.message ?? 'download failed'} (curl fallback: ${error.message})`)
  }
}

if (listOnly) {
  for (const profile of profiles) {
    const target = platform.releaseTarget(profile.id)
    console.log(target === undefined
      ? `  ${profile.id.padEnd(14)} unsupported on ${process.platform}/${process.arch}`
      : `  ${profile.id.padEnd(14)} ${target.label.padEnd(22)} ${target.asset(profile.id, '<version>')}`)
  }
  process.exit(0)
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
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
    skipped.push(profile.id)
    console.log(`${profile.id.padEnd(14)} ${String(marker.version).padEnd(8)} already installed`)
    continue
  }
  try {
    const { version, tag, asset } = await findAsset(profile.id, target)
    const archive = join(installRoot, `.download-${asset.name}`)
    process.stdout.write(`${profile.id.padEnd(14)} ${tag.padEnd(8)} downloading ${(asset.size / 1e6).toFixed(1)} MB… `)
    const bytes = await download(profile.id, asset, archive)
    const member = extractFromArchive(archive, join(installRoot, `.extract-${profile.id}`), target, profile.id)
    copyFileSync(member, binPath)
    if (process.platform !== 'win32') chmodSync(binPath, 0o755)
    rmSync(archive, { force: true })
    rmSync(join(installRoot, `.extract-${profile.id}`), { recursive: true, force: true })
    writeFileSync(markerPath, JSON.stringify({ id: profile.id, version, tag, asset: asset.name, platform: process.platform, arch: process.arch }, undefined, 2) + '\n')
    console.log(`ok (${(bytes / 1e6).toFixed(1)} MB) → ${binPath}`)
    installed.push(profile.id)
  } catch (error) {
    console.log(`FAILED — ${error.message}`)
  }
}

console.log(`\ninstalled ${installed.length}, already present ${skipped.length}`)
if (installed.length > 0) {
  console.log(`The plugins find these automatically: ${installRoot}`)
}
