#!/usr/bin/env node
/**
 * Compile the craft-kit kernel from TypeScript to plain ESM.
 *
 * The DSH loader imports plugin packages as ordinary ESM. Shipping the kernel
 * as checked-in JavaScript means a plugin works with no build step and no
 * experimental flags, on any Node the harness supports.
 *
 * `src/*.ts` stays the single source of truth; `lib/` is generated and must be
 * regenerated after editing the kernel (the verifier fails if it is stale).
 *
 * Usage: node scripts/build-kit.mjs [--check]
 * @module scripts/build-kit
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
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

let stale = 0
const written = []
for (const file of readdirSync(srcDir).sort()) {
  if (!file.endsWith('.ts') && !file.endsWith('.mjs') && !file.endsWith('.json')) continue
  const target = join(outDir, file.endsWith('.ts') ? file.replace(/\.ts$/, '.js') : file)
  // Plain `.mjs`/`.json` assets (the profile registry) are copied verbatim so
  // `src/` and `lib/` resolve the same relative specifiers.
  const compiled = file.endsWith('.ts')
    ? rewriteSpecifiers(stripTypeScriptTypes(readFileSync(join(srcDir, file), 'utf8'), { mode: 'strip' }))
    : readFileSync(join(srcDir, file), 'utf8')
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (previous === compiled) continue
  if (check) { stale += 1; console.error(`stale: lib/${file.replace(/\.ts$/, '.js')}`); continue }
  writeFileSync(target, compiled)
  written.push(file.replace(/\.ts$/, '.js'))
}

if (check) {
  if (stale > 0) {
    console.error(`\n${stale} generated kernel file(s) are stale — run: node scripts/build-kit.mjs`)
    process.exit(1)
  }
  console.log('craft-kit/lib is up to date')
} else {
  console.log(written.length === 0 ? 'craft-kit/lib already up to date' : `wrote ${written.length} file(s): ${written.join(', ')}`)
}
