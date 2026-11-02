#!/usr/bin/env node
/**
 * Download several craft CLIs in parallel, with resume.
 *
 * `scripts/install-craft.mjs` installs sequentially, which is fine for one or
 * two crafts but slow for a full version bump: the release assets total about a
 * gigabyte and only `api.github.com` is reachable from some networks, so each
 * asset comes down the API's redirect at a few MB/s. This runs a small worker
 * pool, resumes a truncated transfer with `curl -C -`, and verifies each file
 * against the size the release API reports before installing it.
 *
 * Usage: node scripts/download-crafts-parallel.mjs [--concurrency 4] [craft ...]
 * @module scripts/download-crafts-parallel
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFromArchive } from './lib/archive.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kit = await import(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'index.js'))
const platform = await import(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'platform.js'))

const argv = process.argv.slice(2)
const concIndex = argv.indexOf('--concurrency')
const concurrency = concIndex === -1 ? 4 : Number(argv[concIndex + 1])
const requested = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--concurrency')
const installRoot = join(root, 'crafts-bin')
const downloadDir = join(root, 'bin', 'dl')
mkdirSync(installRoot, { recursive: true })
mkdirSync(downloadDir, { recursive: true })

const token = process.env.GITHUB_TOKEN
const headers = { 'user-agent': 'dsh-artcraft', accept: 'application/vnd.github+json', ...token ? { authorization: `Bearer ${token}` } : {} }

const profiles = requested.length > 0 ? requested.map(id => kit.profileOf(id)).filter(Boolean) : kit.CRAFT_PROFILES
const target = platform.releaseTarget(process.platform === 'darwin' ? 'darwin' : process.platform, process.arch)

/** The newest macOS CLI asset for one craft. */
async function findAsset(profile) {
  // The API drops connections under concurrency; a short backoff makes the
  // whole run far more reliable than raising the worker count.
  let release
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(`https://api.github.com/repos/storytold/${profile.id}/releases/latest`, { headers })
      if (!res.ok) throw new Error(`release API ${res.status}`)
      release = await res.json()
      break
    } catch (error) {
      lastError = error
      await new Promise(r => setTimeout(r, 2000 * attempt))
    }
  }
  if (release === undefined) throw new Error(`release lookup failed: ${lastError?.message}`)
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const wanted = platform.releaseTarget(profile.id)?.asset(profile.id, version)
  const asset = (release.assets ?? []).find(a => a.name === wanted)
  if (asset === undefined) throw new Error(`no asset ${wanted}`)
  return { version, asset }
}

/** Download with resume until the file matches the reported size. */
function download(asset, destination, craftId) {
  const url = `https://api.github.com/repos/storytold/${craftId}/releases/assets/${asset.id}`
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const have = existsSync(destination) ? statSync(destination).size : 0
    if (have === asset.size) return have
    try {
      execFileSync('curl', [
        '-sSL', '-C', '-', '--retry', '3', '--retry-all-errors', '--max-time', '1800',
        ...token ? ['-H', `Authorization: Bearer ${token}`] : [],
        '-H', 'Accept: application/octet-stream', '-o', destination, url,
      ], { stdio: 'ignore', timeout: 1_900_000 })
    } catch {
      // A dropped transfer still leaves the bytes already fetched on disk, and
      // the next attempt resumes from there.
    }
    const now = existsSync(destination) ? statSync(destination).size : 0
    if (now === asset.size) return now
    if (now === have) {
      // No progress: start over rather than spin on a corrupt partial file.
      rmSync(destination, { force: true })
    }
  }
  throw new Error(`could not complete ${asset.name}`)
}

async function installOne(profile) {
  const { version, asset } = await findAsset(profile)
  const archive = join(downloadDir, asset.name)
  const bytes = download(asset, archive, profile.id)
  const scratch = join(downloadDir, `.extract-${profile.id}`)
  const member = extractFromArchive(archive, scratch, platform.releaseTarget(profile.id), profile.id)
  const binPath = join(installRoot, platform.binaryName(profile.id))
  copyFileSync(member, binPath)
  if (process.platform !== 'win32') chmodSync(binPath, 0o755)
  writeFileSync(join(installRoot, `${profile.id}.version.json`),
    JSON.stringify({ id: profile.id, version, tag: `v${version}`, asset: asset.name, platform: process.platform, arch: process.arch }, undefined, 2) + '\n')
  let reported = version
  try { reported = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 20_000 }).trim().split('\n')[0] } catch { /* some CLIs lack the flag */ }
  return `${profile.id.padEnd(14)} v${version.padEnd(7)} ${(bytes / 1e6).toFixed(1)} MB  ${reported}`
}

const queue = [...profiles]
const results = []
const failures = []
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  while (queue.length > 0) {
    const profile = queue.shift()
    try {
      const line = await installOne(profile)
      results.push(line)
      console.log(`ok   ${line}`)
    } catch (error) {
      failures.push(`${profile.id}: ${error.message}`)
      console.log(`FAIL ${profile.id}: ${error.message}`)
    }
  }
}))

console.log(`\ninstalled ${results.length} of ${profiles.length}${failures.length > 0 ? `, ${failures.length} failed` : ''}`)
for (const failure of failures) console.error(`  ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
