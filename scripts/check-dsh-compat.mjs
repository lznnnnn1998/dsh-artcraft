#!/usr/bin/env node
/**
 * Sentinel for a DSH upgrade.
 *
 * The craft plugins use the harness's tool and prompt services; the preview
 * panel (`dsh-plugins/preview-panel`) also uses the client module system, the
 * `main`/`sidebar.panellist` slots and the `__ModuleLoader__` wire — internals
 * the harness does not promise to keep stable. A renamed slot can leave the
 * panel's entry pending and fail the Web boot audit, so this check runs before
 * a user upgrades and again afterwards.
 *
 * It answers three questions:
 *   1. Is a harness checkout present, and what version is it?
 *   2. Does every package's `engines.dsh` accept that version? (app-boot throws
 *      on an unmet range, so a wrong range is a real install failure.)
 *   3. Does the preview panel still build and verify against that checkout?
 *
 * Usage:
 *   node scripts/check-dsh-compat.mjs
 *   DSH_HARNESS_DIR=/path/to/deepseek-harness node scripts/check-dsh-compat.mjs
 * @module scripts/check-dsh-compat
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Locate a harness checkout that can answer version and semver questions. */
function findHarness() {
  const candidates = [
    process.env.DSH_HARNESS_DIR,
    join(root, '..', 'deepseek-harness'),
    join(homedir(), 'deepseek-harness'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    const appBoot = join(candidate, 'packages', 'boot', 'app-boot', 'package.json')
    if (existsSync(appBoot)) return { dir: candidate, appBoot }
  }
  return undefined
}

const harness = findHarness()
if (harness === undefined) {
  console.error('✗ no DSH checkout found — set DSH_HARNESS_DIR to one, or skip this check.')
  process.exit(2)
}

const runtimeVersion = JSON.parse(readFileSync(harness.appBoot, 'utf8')).version
console.log(`DSH checkout: ${harness.dir}`)
console.log(`runtime version: ${runtimeVersion}`)

// semver comes from the checkout: the repository has no node_modules of its own.
const semverDirectory = join(harness.dir, 'node_modules', 'semver')
if (!existsSync(semverDirectory)) {
  console.error('✗ semver is not installed in that checkout — run `pnpm install` there first.')
  process.exit(2)
}
const semver = (await import(join(semverDirectory, 'index.js'))).default ?? (await import(join(semverDirectory, 'index.js')))

const packages = []
for (const entry of readdirSync(join(root, 'dsh-plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifest = join(root, 'dsh-plugins', entry.name, 'package.json')
  if (!existsSync(manifest)) continue
  packages.push({ file: manifest, manifest: JSON.parse(readFileSync(manifest, 'utf8')) })
}

let failures = 0
console.log(`\nengines.dsh across ${packages.length} package(s):`)
const ranges = new Map()
for (const { manifest } of packages) {
  const range = manifest.engines?.dsh
  if (typeof range !== 'string') {
    console.error(`  ✗ ${manifest.name}: no engines.dsh`)
    failures += 1
    continue
  }
  const ok = semver.satisfies(runtimeVersion, range, { includePrerelease: true })
  ranges.set(range, (ranges.get(range) ?? 0) + 1)
  if (!ok) {
    console.error(`  ✗ ${manifest.name} ${range} does not accept ${runtimeVersion} — app-boot will refuse to load it`)
    failures += 1
  }
}
for (const [range, count] of ranges) console.log(`  ${range} → ${count} package(s)`)

// The panel is the only package that reaches into client internals, so its own
// verification is the part that actually detects a changed slot or bundle wire.
const panelVerify = join(root, 'dsh-plugins', 'preview-panel', 'scripts', 'verify.mjs')
if (existsSync(panelVerify)) {
  console.log('\npreview panel build + verify:')
  try {
    execFileSync(process.execPath, [join(root, 'dsh-plugins', 'preview-panel', 'scripts', 'build.mjs')], {
      cwd: join(root, 'dsh-plugins', 'preview-panel'), stdio: 'pipe', timeout: 300_000,
      env: { ...process.env, DSH_HARNESS_ROOT: harness.dir },
    })
    const out = execFileSync(process.execPath, [panelVerify], {
      cwd: join(root, 'dsh-plugins', 'preview-panel'), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, DSH_HARNESS_ROOT: harness.dir },
    })
    const last = out.trim().split('\n').slice(-2).join('\n')
    console.log(`  ✓ ${last}`)
  } catch (error) {
    failures += 1
    console.error('  ✗ panel build or verify failed — a harness internal may have changed:')
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-8).join('\n')
    console.error(detail.length > 0 ? detail : String(error.message))
  }
}

console.log(failures === 0
  ? `\n✓ compatible with DSH ${runtimeVersion}`
  : `\n✗ ${failures} compatibility problem(s) against DSH ${runtimeVersion}`)
process.exit(failures === 0 ? 0 : 1)
