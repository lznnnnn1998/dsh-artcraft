#!/usr/bin/env node
/**
 * Build the two artifacts this package ships:
 *
 * - `src/index.js` — the Node loader entry, type-stripped ESM from
 *   `src/index.ts`. The Cordis Loader imports the package's `.` export, so the
 *   shipped entry must be runnable JavaScript; the typed source stays beside it,
 *   the convention the craft plugins use.
 * - `lib/client.js` — the browser bundle, a closure-factory artifact. The
 *   client module system's contract (the only contract that matters to the
 *   loader) is `window.__ModuleLoader__.load({ id, factory })`, where the
 *   factory receives the injected `require` and returns its CJS exports. This
 *   is exactly the shape `packages/client/tsdown.client.ts` emits for in-tree
 *   packages. That preset cannot build an out-of-tree package: it expects a
 *   harness workspace member (a `lib/types` tsc pass, repo-relative source
 *   maps, its module-purity gates, and the `files` layout it publishes). This
 *   package therefore compiles its one browser entry with the TypeScript
 *   compiler the harness checkout already carries and wraps the output in the
 *   same factory envelope. `react` and `react/jsx-runtime` stay runtime
 *   externals: the Web shell seeds both into the frozen module table.
 *
 * Usage:
 *   node scripts/build.mjs
 *   DSH_HARNESS_ROOT=/path/to/deepseek-harness node scripts/build.mjs
 *   DSH_TYPESCRIPT=/path/to/node_modules/typescript node scripts/build.mjs
 * @module dsh-artcraft-preview-panel/scripts/build
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTypeScript } from './lib/toolchain.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const packageName = manifest.name

/** @returns {never} */
function fail(message) {
  console.error(`build: ${message}`)
  process.exit(1)
}

const { directory: typescriptDirectory, ts } = (() => {
  try {
    return resolveTypeScript(packageRoot)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
})()

/**
 * Transpile one source file.
 * @param relativeFile - source path relative to the package root.
 * @param compilerOptions - ts compiler options.
 * @returns the emitted JavaScript.
 */
function transpile(relativeFile, compilerOptions) {
  const sourceFile = join(packageRoot, relativeFile)
  const source = readFileSync(sourceFile, 'utf8')
  const result = ts.transpileModule(source, {
    fileName: relativeFile,
    reportDiagnostics: true,
    compilerOptions: {
      newLine: ts.NewLineKind.LineFeed,
      removeComments: false,
      ...compilerOptions,
    },
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => '\n',
    })
    fail(`${relativeFile} did not transpile:\n${formatted}`)
  }
  return result.outputText
}

/** Indent every line so the wrapped body reads like a generated bundle. */
function indent(text, prefix) {
  return text.replace(/\n$/u, '').split('\n').map(line => (line.length === 0 ? line : prefix + line)).join('\n')
}

// ── host entry ───────────────────────────────────────────────────────────────

const hostSource = transpile('src/index.ts', {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
})
writeFileSync(join(packageRoot, 'src/index.js'), [
  '// Generated from src/index.ts by scripts/build.mjs — do not edit by hand.',
  hostSource.trimEnd(),
  '',
].join('\n'))
console.log(`built   src/index.js  (${Buffer.byteLength(hostSource)} bytes)`)

// ── browser bundle ───────────────────────────────────────────────────────────

const clientSource = transpile('src/client.tsx', {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
})

const bundle = [
  '/**',
  ` * ${packageName} — browser closure-factory bundle.`,
  ' *',
  ' * Generated from src/client.tsx by scripts/build.mjs — do not edit by hand.',
  ' * The module loader registers this factory and materializes it on first',
  ' * import; every module-body side effect (the injected stylesheet included)',
  ' * stays inside the factory closure, matching the tsdown client envelope.',
  ' */',
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(packageName)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  indent(clientSource, '\t\t'),
  '\t\treturn module.exports;',
  '\t},',
  '});',
  '',
].join('\n')

// Compile once without executing: catches a broken emit before it reaches the
// browser, where a failing entry would fail the whole page's boot audit.
try {
  // eslint-disable-next-line no-new-func
  new Function(bundle)
} catch (error) {
  fail(`lib/client.js is not valid JavaScript: ${String(error)}`)
}

mkdirSync(join(packageRoot, 'lib'), { recursive: true })
writeFileSync(join(packageRoot, 'lib/client.js'), bundle)
console.log(`built   lib/client.js (${Buffer.byteLength(bundle)} bytes)`)
console.log(`typescript: ${typescriptDirectory}`)


// The panel fetches layer B's server, so the panel package ships it: a profile
// install must be self-contained — the repository path is not there afterwards.
const repoPreview = resolve(packageRoot, '..', '..', 'scripts', 'preview')
const packagedServer = resolve(packageRoot, 'server')
if (existsSync(join(repoPreview, 'server.mjs'))) {
  mkdirSync(packagedServer, { recursive: true })
  cpSync(join(repoPreview, 'server.mjs'), join(packagedServer, 'server.mjs'))
  cpSync(join(repoPreview, 'panel.html'), join(packagedServer, 'panel.html'))
  console.log('packaged scripts/preview/{server.mjs,panel.html} into server/')
}
