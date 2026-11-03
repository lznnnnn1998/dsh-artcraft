/**
 * Locate the TypeScript compiler a DSH checkout already carries. Shared by
 * `build.mjs` (transpile) and `verify.mjs` (type-check) so the two agree on a
 * checkout and fail with one message.
 *
 * Resolution order: `DSH_TYPESCRIPT`, `DSH_HARNESS_ROOT`, the workspace
 * convention (`<workspace>/dsh-artcraft` next to `<workspace>/deepseek-harness`),
 * `./node_modules/typescript`, then a bare resolution.
 * @module dsh-artcraft-preview-panel/scripts/lib/toolchain
 */

import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @typedef {{ directory: string, tsc: string, ts: typeof import('typescript') }} TypeScriptToolchain
 */

/** Load one candidate directory or file path. */
function loadCandidate(specifier) {
  try {
    const anchor = specifier.endsWith('.js')
      ? pathToFileURL(specifier).href
      : pathToFileURL(join(specifier, 'package.json')).href
    const require = createRequire(anchor)
    const module = require(specifier)
    if (typeof module?.transpileModule !== 'function') return undefined
    const directory = specifier.endsWith('.js') ? resolve(specifier, '..', '..') : resolve(specifier)
    const tsc = require.resolve('typescript/lib/tsc.js')
    return { directory, tsc, ts: module }
  } catch {
    return undefined
  }
}

/**
 * Resolve the compiler.
 * @param packageRoot - this package's directory (anchors the workspace convention).
 * @returns the toolchain.
 * @throws {Error} listing every candidate when none resolves.
 */
export function resolveTypeScript(packageRoot) {
  const tried = []
  const candidates = []
  if (process.env.DSH_TYPESCRIPT !== undefined && process.env.DSH_TYPESCRIPT.length > 0) {
    candidates.push(resolve(process.env.DSH_TYPESCRIPT))
  }
  if (process.env.DSH_HARNESS_ROOT !== undefined && process.env.DSH_HARNESS_ROOT.length > 0) {
    candidates.push(join(resolve(process.env.DSH_HARNESS_ROOT), 'node_modules', 'typescript'))
  }
  // This workspace's checkout convention: dsh-artcraft and deepseek-harness
  // are siblings under the same parent directory.
  candidates.push(resolve(packageRoot, '../../../../..', 'deepseek-harness', 'node_modules', 'typescript'))
  candidates.push(resolve(process.cwd(), 'node_modules', 'typescript'))

  for (const candidate of candidates) {
    tried.push(candidate)
    const toolchain = loadCandidate(candidate)
    if (toolchain !== undefined) return toolchain
  }
  // A tree that already depends on typescript resolves it normally.
  try {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('typescript')
    const toolchain = loadCandidate(entry)
    if (toolchain !== undefined) return toolchain
  } catch {
    // Fall through to the diagnostic.
  }
  throw new Error([
    'cannot find the TypeScript compiler.',
    'Set DSH_HARNESS_ROOT to a deepseek-harness checkout (it bundles typescript),',
    'or DSH_TYPESCRIPT to a typescript package directory. Tried:',
    ...tried.map(candidate => `  - ${candidate}`),
    'The committed src/index.js and lib/client.js are already built; the compiler',
    'is only needed to rebuild or type-check them from src/.',
  ].join('\n'))
}
