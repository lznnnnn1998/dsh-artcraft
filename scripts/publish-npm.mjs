#!/usr/bin/env node
/**
 * Publish the craft plugins, skipping whatever npm already has.
 *
 * npm throttles publishing per account and does not document the quota, so a
 * bulk publish of twelve packages can stop partway with `E429 rate limited
 * exceeded`. This publishes only the versions the registry is missing, which
 * makes a retry cheap and safe to run repeatedly: already-published packages
 * are skipped, and a throttled one is left for the next run.
 *
 * Usage:
 *   node scripts/publish-npm.mjs --dry-run          # show what is missing
 *   node scripts/publish-npm.mjs                    # publish the missing ones
 *   node scripts/publish-npm.mjs --only wordcraft   # one craft
 *   node scripts/publish-npm.mjs --retry-wait 300   # seconds between attempts
 *
 * The npm token is read from the environment, never from this file:
 *   NPM_CONFIG_USERCONFIG=/path/to/npmrc node scripts/publish-npm.mjs
 *
 * Publishing is done with whichever package manager this machine has — the
 * bundled pnpm when there is no global one, which is the usual situation on
 * Windows, where `npm` is a `.cmd` shim Node cannot spawn directly.
 * @module scripts/publish-npm
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PM_ENV, packageManager, parseArgv, readJson, runPackageManager } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'dsh-plugins')
const args = parseArgv(process.argv.slice(2), ['--retry-wait', '--only'])
const dryRun = args.has('--dry-run')
const retryWait = Number(args.value('--retry-wait', '120'))
const only = args.value('--only', undefined)

/** Every plugin package, in the order they should be published. */
function plugins() {
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
    .map(entry => join(pluginsDir, entry.name))
    .filter(dir => existsSync(join(dir, 'package.json')))
    .map(dir => ({ dir, manifest: readJson(join(dir, 'package.json')) }))
    .filter(plugin => only === undefined || plugin.manifest.name.endsWith(`-${only}`))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

/** The version the registry currently serves, or `undefined`. */
async function publishedVersion(name) {
  const response = await fetch(`https://registry.npmjs.org/${name}`, { headers: { accept: 'application/json' } })
  if (!response.ok) return undefined
  const body = await response.json()
  return body?.['dist-tags']?.latest
}

const all = plugins()
if (all.length === 0) {
  console.error(only === undefined ? 'no plugin packages found' : `no package matching --only ${only}`)
  process.exit(2)
}

console.log(`checking ${all.length} package(s) against registry.npmjs.org\n`)
const missing = []
for (const plugin of all) {
  const { name, version } = plugin.manifest
  const live = await publishedVersion(name)
  const state = live === version ? 'published' : live === undefined ? 'MISSING' : `MISSING (registry has ${live})`
  console.log(`  ${name.padEnd(38)} ${version.padEnd(8)} ${state}`)
  if (live !== version) missing.push(plugin)
}

if (missing.length === 0) {
  console.log('\neverything is published')
  process.exit(0)
}
if (dryRun) {
  console.log(`\n--dry-run: ${missing.length} package(s) would be published`)
  process.exit(0)
}

console.log(`\npublishing ${missing.length} package(s)…`)
const pm = packageManager()
console.log(`package manager: ${pm.label}  (${pm.source})`)
console.log(`Set ${PM_ENV} to override it.\n`)
let ok = 0
const throttled = []
for (const [index, plugin] of missing.entries()) {
  const { name } = plugin.manifest
  process.stdout.write(`  ${name.padEnd(38)} `)
  let output = ''
  try {
    output = runPackageManager(pm, ['publish'], { cwd: plugin.dir, encoding: 'utf8', stdio: 'pipe', timeout: 600_000 })
    console.log('ok')
    ok += 1
  } catch (error) {
    const text = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (text.includes('E429') || text.includes('rate limited')) {
      // Throttled: stop rather than burn the remaining attempts, because the
      // quota is per account and further calls only extend the wait.
      console.log('throttled (E429)')
      throttled.push(name)
      console.log(`\nnpm is throttling this account. ${missing.length - index - 1} package(s) not attempted.`)
      console.log('Re-run this script later — already-published packages are skipped automatically.')
      break
    }
    console.log('FAILED')
    console.error(text.split('\n').filter(line => line.includes('npm error')).slice(0, 4).join('\n'))
  }
  if (index < missing.length - 1 && retryWait > 0) await new Promise(done => setTimeout(done, retryWait * 1000))
}

console.log(`\npublished ${ok} of ${missing.length}${throttled.length > 0 ? `, ${throttled.length} throttled` : ''}`)
process.exit(throttled.length > 0 ? 1 : 0)
