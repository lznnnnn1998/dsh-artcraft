#!/usr/bin/env node
/**
 * Compile the craft-kit kernel and inline it into every plugin package.
 *
 * A published plugin must install with `pnpm add` and load in a profile that
 * knows nothing about this workspace. A shared `@dsh-artcraft/craft-kit`
 * dependency would not survive that: pnpm stores a tarball under
 * `node_modules/.pnpm`, and only the harness's own `@deepseek-ai/*` packages are
 * routed back to the installation. So each kit module is copied, as plain ESM,
 * into `<plugin>/src/kit/` and the plugin imports it by relative path.
 *
 * `dsh-plugins/craft-kit/src/*.ts` stays the single source of truth; this
 * script regenerates `craft-kit/lib/` and every plugin's `src/kit/`.
 *
 * Usage: node scripts/build-kit.mjs [--check]
 * @module scripts/build-kit
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'dsh-plugins', 'craft-kit', 'src')
const outDir = join(root, 'dsh-plugins', 'craft-kit', 'lib')
const check = process.argv.includes('--check')

mkdirSync(outDir, { recursive: true })

/** Rewrite `./x.ts` specifiers to `./x.js` so the emitted ESM resolves. */
function rewriteSpecifiers(code) {
  return code.replace(/(from\s+['"])(\.{1,2}\/[^'"]+?)\.ts(['"])/g, '$1$2.js$3')
}

/** Compile one source file to plain ESM (or copy a `.mjs`/`.json` asset). */
function compile(file, code) {
  return file.endsWith('.ts') ? rewriteSpecifiers(stripTypeScriptTypes(code, { mode: 'strip' })) : code
}

/**
 * Compare generated output with what is on disk, ignoring line endings.
 *
 * A Windows clone checks these files out with CRLF (`core.autocrlf=true`) while
 * a freshly generated file carries the LF of its source, so a byte-wise
 * comparison would report every file as stale on one platform or the other.
 */
function unchanged(previous, compiled) {
  if (previous === undefined) return false
  return previous.replace(/\r\n/g, '\n') === compiled.replace(/\r\n/g, '\n')
}

/** Write `compiled` to `target` unless it is already equivalent. */
function emit(target, compiled, label) {
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (unchanged(previous, compiled)) return 'same'
  if (check) {
    console.error(`stale: ${label}`)
    return 'stale'
  }
  writeFileSync(target, compiled)
  return 'written'
}

const sources = readdirSync(srcDir).sort()
  .filter(file => file.endsWith('.ts') || file.endsWith('.mjs') || file.endsWith('.json'))

// 1. craft-kit/lib — the reference copy, used by scripts and local testing.
let stale = 0
const written = []
for (const file of sources) {
  const target = join(outDir, file.endsWith('.ts') ? file.replace(/\.ts$/, '.js') : file)
  const compiled = compile(file, readFileSync(join(srcDir, file), 'utf8'))
  const outcome = emit(target, compiled, `craft-kit/lib/${file.replace(/\.ts$/, '.js')}`)
  if (outcome === 'stale') stale += 1
  else if (outcome === 'written') written.push(file.replace(/\.ts$/, '.js'))
}

// 2. every plugin's src/kit — the same modules, inlined so the package is
//    self-contained. `profiles.mjs` is what the kernel reads the craft registry
//    from, so the whole set travels together.
// 3. scripts/lib — the same treatment for build-time helpers that carry types.
const scriptLibDir = join(root, 'scripts', 'lib')
if (existsSync(scriptLibDir)) {
  for (const file of readdirSync(scriptLibDir).filter(file => file.endsWith('.ts'))) {
    const target = join(scriptLibDir, file.replace(/\.ts$/, '.js'))
    const compiled = compile(file, readFileSync(join(scriptLibDir, file), 'utf8'))
    const outcome = emit(target, compiled, `scripts/lib/${file.replace(/\.ts$/, '.js')}`)
    if (outcome === 'stale') stale += 1
    else if (outcome === 'written') written.push(`scripts/lib/${file.replace(/\.ts$/, '.js')}`)
  }
}

const pluginsDir = join(root, 'dsh-plugins')
const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
  .map(entry => join(pluginsDir, entry.name))
  .filter(dir => existsSync(join(dir, 'src', 'index.ts')))
  .sort()

const inlined = []
let entries = 0
for (const plugin of plugins) {
  const label = plugin.slice(root.length + 1)
  const kitDir = join(plugin, 'src', 'kit')
  if (!check) {
    rmSync(kitDir, { recursive: true, force: true })
    mkdirSync(kitDir, { recursive: true })
  }
  for (const file of sources) {
    const name = file.endsWith('.ts') ? file.replace(/\.ts$/, '.js') : file
    const compiled = compile(file, readFileSync(join(srcDir, file), 'utf8'))
    const outcome = emit(join(kitDir, name), compiled, `${label}/src/kit/${name}`)
    if (outcome === 'stale') stale += 1
  }

  // 4. the plugin's own entry modules (`index.ts`, `root.ts`) — emitted as plain
  //    ESM beside their sources, and what `exports` actually points at.
  //
  //    A plugin reaches a profile as an installed package, so Node loads it from
  //    `node_modules`; Node refuses to strip types there
  //    (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), which would leave an
  //    install that succeeded but could never load. The `.ts` files stay the
  //    source of truth and still ship, so this is the same generated-JS pattern
  //    the kernel above already uses.
  const entryDir = join(plugin, 'src')
  for (const entry of readdirSync(entryDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
    const compiled = compile(entry.name, readFileSync(join(entryDir, entry.name), 'utf8'))
    const outcome = emit(join(entryDir, entry.name.replace(/\.ts$/, '.js')), compiled, `${label}/src/${entry.name.replace(/\.ts$/, '.js')}`)
    if (outcome === 'stale') stale += 1
    else entries += 1
  }
  inlined.push(label)
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} generated file(s) are stale — run: node scripts/build-kit.mjs`)
    process.exit(1)
  }
  console.log(`craft-kit/lib, ${inlined.length} inlined kit(s) and ${entries} plugin entry module(s) are up to date`)
} else {
  console.log(written.length === 0
    ? `craft-kit/lib unchanged; re-inlined ${inlined.length} plugin kit(s)`
    : `wrote ${written.length} kernel file(s); inlined into ${inlined.length} plugin(s)`)
  console.log(`compiled ${entries} plugin entry module(s) to plain ESM`)
}
