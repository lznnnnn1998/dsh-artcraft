#!/usr/bin/env node
/**
 * Push local files to a GitHub repository through the REST API.
 *
 * `git push` needs `github.com:443`, which is unreachable from some networks
 * while `api.github.com` works fine. This walks the local HEAD against the
 * remote tree, uploads only the differing blobs, and creates one commit via
 * the git-data API — the same result a `git push` would produce, without the
 * smart-HTTP transport. Requires a token with `contents: write`.
 *
 * Usage:
 *   node scripts/push-via-api.mjs --repo OWNER/NAME --token-file PATH [--branch main] [--dry-run]
 * @module scripts/push-via-api
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
const repo = flag('--repo')
const tokenFile = flag('--token-file')
const branch = flag('--branch', 'main')
const dryRun = argv.includes('--dry-run')

if (repo === undefined || tokenFile === undefined) {
  console.error('usage: node scripts/push-via-api.mjs --repo OWNER/NAME --token-file PATH [--branch main] [--dry-run]')
  process.exit(2)
}

const token = readFileSync(resolve(tokenFile), 'utf8')
  .split('\n')
  .map(line => line.replace(/^\s*token:\s*/, '').trim())
  .find(line => line.length > 0 && !line.startsWith('repo:'))
if (token === undefined) {
  console.error('no token found in', tokenFile)
  process.exit(2)
}

const API = 'https://api.github.com'

/** One authenticated JSON request against the GitHub API. */
async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-artcraft-push',
      'content-type': 'application/json',
      ...init.headers ?? {},
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${text.slice(0, 300)}`)
  return text.length === 0 ? undefined : JSON.parse(text)
}

/**
 * Every tracked file with its git blob hash.
 *
 * `git hash-object` is used rather than the index's staged sha: the index can
 * lag the working tree, and the hash it holds for a modified file would make an
 * unchanged file look dirty.
 */
function localTree() {
  const paths = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean)
  if (paths.length === 0) return []
  const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], {
    input: paths.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\n').filter(Boolean)
  return paths.map((path, index) => ({ path, sha: hashes[index] }))
}

const files = localTree()
const remoteHead = await api(`/repos/${repo}/git/ref/heads/${branch}`).catch(() => undefined)
const parentSha = remoteHead?.object?.sha
const remoteCommit = parentSha === undefined ? undefined : await api(`/repos/${repo}/git/commits/${parentSha}`)
const remoteTreeSha = remoteCommit?.tree?.sha

/**
 * Map of repo-relative path → blob sha for the remote tree.
 *
 * GitHub's tree entries carry only the basename, so the recursion has to carry
 * the parent prefix itself; without it every nested file looks renamed and the
 * whole repository reads as changed.
 */
const remoteBlobs = new Map()
if (remoteTreeSha !== undefined) {
  const walk = async (sha, prefix) => {
    const tree = await api(`/repos/${repo}/git/trees/${sha}`)
    for (const entry of tree.tree) {
      const path = prefix.length === 0 ? entry.path : `${prefix}/${entry.path}`
      if (entry.type === 'blob') remoteBlobs.set(path, entry.sha)
      else if (entry.type === 'tree') await walk(entry.sha, path)
    }
  }
  await walk(remoteTreeSha, '')
}

const changed = files.filter(file => remoteBlobs.get(file.path) !== file.sha)
const removed = [...remoteBlobs.keys()].filter(path => !files.some(file => file.path === path))
console.log(`local files: ${files.length} | unchanged: ${files.length - changed.length} | changed: ${changed.length} | removed: ${removed.length}`)
for (const file of changed) console.log(`  M ${file.path}`)
for (const path of removed) console.log(`  D ${path}`)

if (dryRun) {
  console.log('\n--dry-run: nothing uploaded')
  process.exit(0)
}
if (changed.length === 0 && removed.length === 0) {
  console.log('remote already matches the local tree')
  process.exit(0)
}

// Upload each changed file as a blob, then build the new tree entries.
const entries = []
for (const file of changed) {
  const content = readFileSync(file.path)
  const blob = await api(`/repos/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  })
  entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha })
  process.stdout.write('.')
}
// Untouched files keep their remote blob sha; deletions are simply omitted
// because the new tree is built with base_tree and an explicit null sha.
for (const file of files) {
  if (changed.some(c => c.path === file.path)) continue
  entries.push({ path: file.path, mode: '100644', type: 'blob', sha: file.sha })
}
for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null })
console.log(`\nuploaded ${changed.length} blob(s)`)

const tree = await api(`/repos/${repo}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: remoteTreeSha, tree: entries }),
})

const message = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim()
const commit = await api(`/repos/${repo}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: tree.sha,
    ...parentSha !== undefined ? { parents: [parentSha] } : {},
  }),
})

if (parentSha === undefined) {
  await api(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) })
} else {
  await api(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
}

console.log(`pushed ${branch} → ${commit.sha}`)
console.log(`local HEAD is ${execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()}`)
console.log('note: the local commit sha differs from the remote one (the API re-creates the commit)')
