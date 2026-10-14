/**
 * Resolve and fetch a craft's published release artifact.
 *
 * Both installers — `install-craft.mjs` (into the harness home) and
 * `fetch-binaries.mjs` (into the workspace's `crafts-bin/`) — need exactly this
 * much: ask GitHub for the newest release, pick the archive the *current*
 * platform can actually run, download it, and pull the one CLI member out of
 * it. Keeping it here means the macOS-only code path that used `unzip` and
 * `xattr` no longer has to exist: archives are unpacked by `lib/archive.mjs`
 * with Node built-ins, which works identically on Windows.
 *
 * Nothing in this module is craft-specific, and nothing in it needs a POSIX
 * shell, `unzip`, `tar` or a Rust toolchain.
 * @module scripts/lib/craft-release
 */

import { createWriteStream, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { rmSync } from 'node:fs'

/** GitHub organization owning every craft repository. */
export const CRAFT_ORG = 'storytold'

/** Request headers shared by the API calls. */
function apiHeaders(accept) {
  const headers = { 'user-agent': 'dsh-artcraft', accept }
  if (process.env.GITHUB_TOKEN !== undefined && process.env.GITHUB_TOKEN.length > 0) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  return headers
}

/**
 * Ask the GitHub API for the newest release and the archive matching a target.
 *
 * The target's naming rule is data (`craft-kit/lib/platform.js`), so an
 * unsupported platform is a clear error here rather than a mystery 404.
 * @param id - craft id, which is also the repository name.
 * @param target - the platform target from `releaseTarget()`.
 * @returns the version, tag and matching asset.
 * @throws when the release exists but publishes no archive for this platform.
 */
export async function resolveRelease(id, target) {
  const response = await fetch(`https://api.github.com/repos/${CRAFT_ORG}/${id}/releases/latest`, {
    headers: apiHeaders('application/vnd.github+json'),
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${CRAFT_ORG}/${id}`)
  const release = await response.json()
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const wanted = target.asset(id, version)
  if (wanted === undefined) throw new Error(`no ${target.label} asset naming rule for ${id}`)
  const asset = (release.assets ?? []).find((candidate) => candidate.name === wanted)
  if (asset === undefined) {
    const suffix = target.container === 'zip' ? '.zip' : '.tar.gz'
    const available = (release.assets ?? [])
      .map((candidate) => candidate.name)
      .filter((name) => name.endsWith(suffix))
    throw new Error(`asset ${wanted} not in ${release.tag_name}. Available archives: ${available.slice(0, 4).join(', ') || '(none)'}`)
  }
  return { version, tag: release.tag_name, asset }
}

/**
 * Download a release asset through the API endpoint.
 *
 * The endpoint redirects to a signed CDN URL and also works when `github.com`
 * itself is unreachable. Streaming to a file keeps a 96 MB Windows archive out
 * of memory. A CDN drop mid-transfer is the most common failure on a slow
 * link, so each attempt restarts from zero and a size check decides whether it
 * completed.
 * @param id - craft id (the repository name).
 * @param asset - the release asset to fetch.
 * @param destination - file to write.
 * @param options - `attempts` and an optional progress sink.
 * @returns the number of bytes written.
 */
export async function downloadAsset(id, asset, destination, options = {}) {
  const attempts = options.attempts ?? 3
  const onRetry = options.onRetry
  const url = `https://api.github.com/repos/${CRAFT_ORG}/${id}/releases/assets/${asset.id}`
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // The cleanup is inside the retry on purpose: on Windows a Defender scan
      // or the indexer can hold a just-written file for a moment, and an
      // EBUSY/EPERM from `rmSync` used to abort the whole install instead of
      // being retried.
      rmSync(destination, { force: true })
      const response = await fetch(url, { headers: apiHeaders('application/octet-stream'), redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
      const size = statSync(destination).size
      if (size !== asset.size) throw new Error(`truncated: ${size} of ${asset.size} bytes`)
      return size
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        onRetry?.(attempt)
        // Give a transient lock a moment to clear before trying again.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * attempt))
      }
    }
  }
  // Fall back to the platform's own HTTP client, which handles proxies,
  // certificate stores and slow CDN links differently from Node's fetch.
  // Windows 10 1803 and later ship `curl.exe`, so this is a real fallback
  // there too rather than a POSIX-only one.
  try {
    rmSync(destination, { force: true })
    const args = ['-sSL', '--retry', '3', '--retry-all-errors', '--fail', '-o', destination]
    if (process.env.GITHUB_TOKEN !== undefined && process.env.GITHUB_TOKEN.length > 0) {
      args.push('-H', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`)
    }
    args.push('-H', 'Accept: application/octet-stream', url)
    execFileSync('curl', args, { stdio: 'ignore', timeout: 900_000 })
    const size = statSync(destination).size
    if (size !== asset.size) throw new Error(`truncated via curl: ${size} of ${asset.size} bytes`)
    return size
  } catch (error) {
    throw new Error(`${lastError?.message ?? 'download failed'} (curl fallback: ${error.message})`)
  }
}

/**
 * Human-readable archive size.
 * @param bytes - the size in bytes.
 * @returns a one-decimal megabyte string.
 */
export function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`
}
