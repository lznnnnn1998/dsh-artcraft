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

const sources = readdirSync(srcDir).sort()
  .filter(file => file.endsWith('.ts') || file.endsWith('.mjs') || file.endsWith('.json'))

// 1. craft-kit/lib — the reference copy, used by scripts and local testing.
let stale = 0
const written = []
for (const file of sources) {
  const target = join(outDir, file.endsWith('.ts') ? file.replace(/\.ts$/, '.js') : file)
  const compiled = compile(file, readFileSync(join(srcDir, file), 'utf8'))
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (previous === compiled) continue
  if (check) { stale += 1; console.error(`stale: craft-kit/lib/${file.replace(/\.ts$/, '.js')}`); continue }
  writeFileSync(target, compiled)
  written.push(file.replace(/\.ts$/, '.js'))
}

// 2. every plugin's src/kit — the same modules, inlined so the package is
//    self-contained. `profiles.mjs` is what the kernel reads the craft registry
//    from, so the whole set travels together.
const pluginsDir = join(root, 'dsh-plugins')
const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name.startsWith('plugin-'))
  .map(entry => join(pluginsDir, entry.name))
  .filter(dir => existsSync(join(dir, 'src', 'index.ts')))
  .sort()

const inlined = []
for (const plugin of plugins) {
  const kitDir = join(plugin, 'src', 'kit')
  if (!check) {
    rmSync(kitDir, { recursive: true, force: true })
    mkdirSync(kitDir, { recursive: true })
  }
  for (const file of sources) {
    const name = file.endsWith('.ts') ? file.replace(/\.ts$/, '.js') : file
    const compiled = compile(file, readFileSync(join(srcDir, file), 'utf8'))
    const target = join(kitDir, name)
    const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
    if (previous === compiled) continue
    if (check) {
      stale += 1
      console.error(`stale: ${plugin.slice(root.length + 1)}/src/kit/${name}`)
      continue
    }
    writeFileSync(target, compiled)
  }
  inlined.push(plugin.slice(root.length + 1))
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} generated file(s) are stale — run: node scripts/build-kit.mjs`)
    process.exit(1)
  }
  console.log(`craft-kit/lib and ${inlined.length} inlined kit(s) are up to date`)
} else {
  console.log(written.length === 0
    ? `craft-kit/lib unchanged; re-inlined ${inlined.length} plugin kit(s)`
    : `wrote ${written.length} kernel file(s); inlined into ${inlined.length} plugin(s)`)
}
