#!/usr/bin/env node
/**
 * Push local files to a GitHub repository through the REST API.
 *
 * `git push` needs `github.com:443`, which is unreachable from some networks
 * while `api.github.com` works fine. This uploads the differing blobs and
 * creates one commit via the git-data API — the same result a `git push` would
 * produce, without the smart-HTTP transport. Requires a token with
 * `contents: write`.
 *
 * ## This pushes a whole-tree snapshot, so it can destroy work
 *
 * The API builds a tree from *your local files*, and anything absent locally
 * reads to GitHub as a deletion. A clone that has not fetched the current remote
 * head therefore does not merely fail to fast-forward — it **reverts whatever
 * another machine pushed**, silently, while looking like an ordinary commit.
 * That has happened for real: a macOS clone that predated a Windows commit
 * reverted seventeen files and reported it as a version bump.
 *
 * Three guards make that impossible to do by accident:
 *
 *   1. the remote head must be known locally (i.e. you have fetched at some
 *      point) and be an ancestor of `HEAD`, or the push refuses unless
 *      `--expect-head` pins the head you verified, or `--force-stale` waives the
 *      check outright;
 *   2. remote paths missing locally are treated as deletions and refuse to
 *      proceed unless `--allow-delete` names that intent;
 *   3. the tree GitHub builds must hash identically to the local tree, or
 *      nothing is published — this is what catches line-ending damage.
 *
 * Content is taken from a throwaway index (`GIT_INDEX_FILE`), never from raw
 * working-tree bytes. On a Windows checkout the working tree holds CRLF while
 * the repository stores LF, so uploading the bytes directly would commit CRLF
 * and rewrite every touched file's line endings.
 *
 * Usage:
 *   node scripts/push-via-api.mjs --repo OWNER/NAME --token-file PATH [--branch main]
 *   node scripts/push-via-api.mjs … --dry-run          # show what would change
 *   node scripts/push-via-api.mjs … --message "…"      # override the commit message
 *   node scripts/push-via-api.mjs … --message-file F   # …or read it from a file
 *   node scripts/push-via-api.mjs … --allow-delete     # deletions are intended
 *   node scripts/push-via-api.mjs … --expect-head SHA  # only if the remote head is SHA
 *   node scripts/push-via-api.mjs … --force-stale      # I have not fetched; proceed anyway
 *
 * Only files git already tracks are published: commit anything new locally
 * first, exactly as `git push` would require.
 * @module scripts/push-via-api
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgv } from './lib/host.mjs'

const args = parseArgv(process.argv.slice(2), ['--repo', '--token-file', '--branch', '--message', '--message-file', '--expect-head'])
const repo = args.value('--repo', undefined)
const tokenFile = args.value('--token-file', undefined)
const branch = args.value('--branch', 'main')
const dryRun = args.has('--dry-run')
const allowDelete = args.has('--allow-delete')
const forceStale = args.has('--force-stale')
const expectHead = args.value('--expect-head', undefined)

if (repo === undefined || tokenFile === undefined) {
  console.error('usage: node scripts/push-via-api.mjs --repo OWNER/NAME --token-file PATH [--branch main]')
  console.error('       [--dry-run] [--message MSG] [--allow-delete] [--force-stale]')
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
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim()

/**
 * The commit this clone last created through the API, if any.
 *
 * An API-created commit cannot be referenced locally — the sha differs from the
 * local one — so without this, the second push from the same clone would trip
 * the stale-clone guard over a commit it made itself seconds earlier. Stored in
 * `.git/`, so it is never committed or pushed.
 */
const lastPushFile = join(gitDir, 'artcraft-pushed-head')
const lastPushedHead = (() => {
  try {
    return readFileSync(lastPushFile, 'utf8').trim()
  } catch {
    return undefined
  }
})()

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
 * Run git in the repository, capturing output.
 *
 * stderr is captured rather than inherited: `git add` prints an advisory
 * ("LF will be replaced by CRLF") for every file on a Windows checkout with
 * `core.autocrlf=true`, which would otherwise flood the caller's terminal for
 * what is normal, expected behaviour.
 */
function git(argv, options = {}) {
  return execFileSync('git', argv, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
}

/** Run git, reporting only whether it succeeded. */
function gitOk(argv) {
  try {
    execFileSync('git', argv, { cwd: root, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// --- 1. what the working tree would commit, with git's own filters applied ----
//
// A scratch index is populated from HEAD and then refreshed from the working
// tree, so `core.autocrlf` and `.gitattributes` decide the stored bytes. The
// real index is never touched.
const scratch = mkdtempSync(join(tmpdir(), 'artcraft-push-'))
const scratchIndex = join(scratch, 'index')
const indexed = (argv, options = {}) => git(argv, { ...options, env: { ...process.env, GIT_INDEX_FILE: scratchIndex } })
const indexedOk = (argv) => {
  try {
    execFileSync('git', argv, { cwd: root, stdio: 'ignore', env: { ...process.env, GIT_INDEX_FILE: scratchIndex } })
    return true
  } catch {
    return false
  }
}

try {
  if (indexedOk(['rev-parse', '--verify', 'HEAD'])) indexedOk(['read-tree', 'HEAD'])
  else indexedOk(['read-tree', '--empty'])
  // `-u` refreshes tracked files only, matching what this script published
  // before: new untracked files are the caller's job to commit first.
  indexed(['add', '-u'])

  const localTree = indexed(['write-tree']).trim()
  const listing = indexed(['ls-files', '-s', '-z'], { encoding: 'buffer' })
  const files = []
  for (const record of listing.toString('utf8').split('\0')) {
    if (record.length === 0) continue
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const [mode, sha] = record.slice(0, tab).split(' ')
    files.push({ path: record.slice(tab + 1), sha, mode })
  }
  if (files.length === 0) {
    console.error('no tracked files to push')
    process.exit(2)
  }

  // --- 2. compare against the remote tree -----------------------------------
  const remoteHead = await api(`/repos/${repo}/git/ref/heads/${branch}`).catch(() => undefined)
  const parentSha = remoteHead?.object?.sha
  const remoteCommit = parentSha === undefined ? undefined : await api(`/repos/${repo}/git/commits/${parentSha}`)
  const remoteTreeSha = remoteCommit?.tree?.sha

  // --- 3. refuse to publish from a clone that is behind ----------------------
  //
  // `--expect-head` is the precise form: it pins the remote head this push was
  // prepared against, so a commit that lands in between (two machines, two
  // sessions) refuses instead of being reverted. Prefer it over `--force-stale`,
  // which waives the ancestry check entirely.
  if (expectHead !== undefined && expectHead !== parentSha) {
    console.error(`refusing to publish: expected remote head ${expectHead}, found ${parentSha}.`)
    console.error('Something was pushed in between. Re-read the remote, incorporate it, and retry.')
    process.exit(2)
  }

  if (parentSha !== undefined && expectHead === undefined) {
    const known = gitOk(['cat-file', '-e', `${parentSha}^{commit}`])
    const ancestor = known && gitOk(['merge-base', '--is-ancestor', parentSha, 'HEAD'])
    // A commit this clone made through the API is recognisable, even though its
    // sha cannot exist locally.
    const ours = lastPushedHead !== undefined && lastPushedHead === parentSha
    if (!ancestor && !ours && !forceStale) {
      console.error(known
        ? `this clone does not contain the remote head ${parentSha.slice(0, 8)} — it is behind or diverged.`
        : `this clone has never fetched the remote head ${parentSha.slice(0, 8)} ("${String(remoteCommit?.message ?? '').split('\n')[0]}").`)
      console.error('')
      console.error('Pushing a tree from here would revert every file that machine changed, silently,')
      console.error('because anything absent from this working tree reads to GitHub as a deletion.')
      console.error('')
      console.error(`  git fetch origin && git merge origin/${branch}      # or rebase`)
      console.error('')
      console.error('Where `git fetch` cannot reach github.com, confirm the remote head by other')
      console.error('means and pin it: --expect-head <sha>. Use --force-stale only if you cannot')
      console.error('name the head you verified, and accept that a concurrent push would be lost.')
      process.exit(2)
    }
    if (!ancestor && !ours) {
      console.error(`warning: proceeding past remote head ${parentSha.slice(0, 8)}, which is not an ancestor of HEAD (--force-stale)`)
    }
    if (ours) console.error(`remote head ${parentSha.slice(0, 8)} is the commit this clone pushed last`)
  }
  if (expectHead !== undefined) {
    console.error(`remote head pinned and confirmed: ${String(parentSha).slice(0, 8)}`)
  }

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

  // --- 4. deletions must be intended ----------------------------------------
  // A dry run always reports, so the deletions can be inspected before deciding;
  // only a real push refuses.
  if (removed.length > 0 && !allowDelete && !dryRun) {
    console.error('')
    console.error(`${removed.length} path(s) exist on the remote but not in this working tree.`)
    console.error('GitHub will delete them. If that is not what you mean, this clone is behind —')
    console.error(`fetch and merge origin/${branch} first. Re-run with --allow-delete to confirm.`)
    process.exit(2)
  }

  if (dryRun) {
    if (removed.length > 0 && !allowDelete) {
      console.log('')
      console.log(`note: those ${removed.length} deletion(s) would be refused on a real push without --allow-delete.`)
    }
    console.log('\n--dry-run: nothing uploaded')
    process.exit(0)
  }
  if (changed.length === 0 && removed.length === 0) {
    console.log('remote already matches the local tree')
    process.exit(0)
  }

  // --- 5. upload the stored (filtered) bytes, never the working-tree bytes ---
  const entries = []
  for (const file of changed) {
    const content = indexed(['cat-file', 'blob', file.sha], { encoding: 'buffer' })
    const blob = await api(`/repos/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    })
    if (blob.sha !== file.sha) {
      throw new Error(`${file.path}: uploaded bytes do not match the stored blob (${blob.sha} vs ${file.sha})`)
    }
    entries.push({ path: file.path, mode: file.mode, type: 'blob', sha: blob.sha })
    process.stdout.write('.')
  }
  for (const file of files) {
    if (changed.some(candidate => candidate.path === file.path)) continue
    entries.push({ path: file.path, mode: file.mode, type: 'blob', sha: file.sha })
  }
  for (const path of removed) entries.push({ path, mode: '100644', type: 'blob', sha: null })
  console.log(`\nuploaded ${changed.length} blob(s)`)

  const tree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: remoteTreeSha, tree: entries }),
  })

  // --- 6. the built tree must be the local tree, or nothing is published -----
  if (tree.sha !== localTree) {
    console.error('')
    console.error(`refusing to publish: GitHub built tree ${tree.sha}, but the local tree is ${localTree}.`)
    console.error('The remote content would not match this working tree, which usually means line')
    console.error('endings or file modes were altered in transit. Nothing was published.')
    process.exit(1)
  }

  const messageFile = args.value('--message-file', undefined)
  const message = args.value('--message', undefined)
    ?? (messageFile === undefined ? undefined : readFileSync(resolve(messageFile), 'utf8'))
    ?? execFileSync('git', ['log', '-1', '--pretty=%B'], { cwd: root, encoding: 'utf8' }).trim()
  const commit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, ...parentSha !== undefined ? { parents: [parentSha] } : {} }),
  })

  if (parentSha === undefined) {
    await api(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) })
  } else {
    await api(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
  }

  console.log(`pushed ${branch} → ${commit.sha}`)
  console.log(`tree ${tree.sha} matches the local tree`)
  // Recorded so a later push from this clone recognises its own commit instead
  // of tripping the stale-clone guard.
  writeFileSync(lastPushFile, `${commit.sha}\n`)
  if (parentSha !== undefined && !gitOk(['cat-file', '-e', `${parentSha}^{commit}`])) {
    console.log('note: this clone cannot see the new head locally — `git fetch` when the network allows,')
    console.log('      or push again from here and it will be recognised as this clone\'s own commit.')
  }
  console.log('note: the local commit sha differs from the remote one (the API re-creates the commit)')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
