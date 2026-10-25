#!/usr/bin/env node
/**
 * Validate the awesome-dsh-plugin submission files in `docs/registry/entries/`.
 *
 * These are the files that get pasted into the curated registry, whose CI
 * parses them as YAML before anything else. A regex check is not enough: an
 * unquoted `: ` inside a description turns the rest of the line into a nested
 * mapping and the entry fails with "bad indentation of a mapping entry" — the
 * exact failure this script exists to catch locally.
 *
 * `js-yaml` is taken from the harness checkout this repository already needs
 * for `scripts/install-links.mjs`, so validating needs no install of its own.
 *
 * Usage: node scripts/validate-registry-entries.mjs
 * @module scripts/validate-registry-entries
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(dirname(import.meta.url.replace('file://', '')), '..')
const entriesDir = join(root, 'docs', 'registry', 'entries')

const CATEGORIES = new Set((
  'agi ui usage theme model identity session memory tools wsl browser vision voice docs skill '
  + 'workflow git notify dev security remote market fun'
).split(' '))

/** Locate a harness checkout that provides js-yaml. */
function findYaml() {
  const candidates = [
    process.env.DSH_HARNESS_DIR,
    join(root, '..', 'deepseek-harness'),
    join(homedir(), 'deepseek-harness'),
    join(homedir(), 'Documents', 'deepseek-harness'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    const moduleDir = join(candidate, 'node_modules', 'js-yaml')
    if (existsSync(moduleDir)) return pathToFileURL(join(moduleDir, 'dist', 'js-yaml.mjs')).href
  }
  return undefined
}

const yamlUrl = findYaml()
if (yamlUrl === undefined) {
  console.error('js-yaml not found — set DSH_HARNESS_DIR to a deepseek-harness checkout, or run pnpm install there.')
  process.exit(2)
}
const yaml = await import(yamlUrl)

let failures = 0
const files = readdirSync(entriesDir).filter(name => name.endsWith('.yml')).sort()
if (files.length === 0) {
  console.error(`no .yml entries in ${entriesDir}`)
  process.exit(1)
}

for (const name of files) {
  const path = join(entriesDir, name)
  const problems = []

  let entry
  try {
    entry = yaml.load(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`✗ ${name}\n  YAML does not parse: ${error.message.split('\n')[0]}`)
    failures += 1
    continue
  }
  if (typeof entry !== 'object' || entry === null) {
    console.error(`✗ ${name}\n  not a mapping`)
    failures += 1
    continue
  }

  // 1. URL points at a subdirectory of this repository on its default branch.
  const url = entry.url
  const match = typeof url === 'string'
    ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/.exec(url)
    : null
  if (match === null) problems.push(`url must be https://github.com/<owner>/<repo>/tree/<branch>/<subdir>, got ${JSON.stringify(url)}`)
  let owner, repo, sub
  if (match !== null) {
    [, owner, repo, , sub] = match
    // 2. The subdirectory exists here and declares dsh.bundle.
    const subManifest = join(root, sub, 'package.json')
    if (!existsSync(subManifest)) problems.push(`${sub}/package.json does not exist`)
    else {
      const manifest = JSON.parse(readFileSync(subManifest, 'utf8'))
      if (typeof manifest.dsh?.bundle?.patch !== 'string') problems.push(`${sub} declares no dsh.bundle.patch`)
      // 3. Official packages are peers, not dependencies (registry recommendation).
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (name.startsWith('@deepseek-ai/')) problems.push(`${sub} has ${name} in dependencies; the registry recommends peerDependencies`)
        void version
      }
    }
    // 4. Filename convention: owner__repo--<subdir with / replaced by ->.yml
    const expected = `${owner}__${repo}--${sub.replace(/\//g, '-')}.yml`
    if (name !== expected) problems.push(`filename should be ${expected}`)
    // 5. `name` must name the same repository before the `#`.
    if (typeof entry.name !== 'string' || entry.name.split('#')[0] !== `${owner}/${repo}`) {
      problems.push(`name must start with ${owner}/${repo}#, got ${JSON.stringify(entry.name)}`)
    }
  }

  // 6. A valid category.
  if (!CATEGORIES.has(entry.category)) problems.push(`category ${JSON.stringify(entry.category)} is not in the registry's list`)

  // 7. Both descriptions, non-empty, and no marketing superlatives.
  for (const locale of ['en', 'zh']) {
    const text = entry.description?.[locale]
    if (typeof text !== 'string' || text.trim().length === 0) problems.push(`description.${locale} is missing or empty`)
    else if (/\b(best|greatest|amazing|revolutionary|world-class|ultimate|perfect)\b/i.test(text)) {
      problems.push(`description.${locale} contains a superlative; the registry asks for plain function descriptions`)
    }
  }

  if (problems.length === 0) {
    console.log(`✓ ${name}`)
  } else {
    failures += 1
    console.error(`✗ ${name}`)
    for (const problem of problems) console.error(`    ${problem}`)
  }
}

console.log(failures === 0
  ? `\nall ${files.length} entries are valid`
  : `\n${failures} of ${files.length} entries have problems`)
process.exit(failures === 0 ? 0 : 1)
