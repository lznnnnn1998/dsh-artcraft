#!/usr/bin/env node
/**
 * Verify what can be verified about this package without the Web GUI:
 *
 * 1. the manifest declares the `dsh.client` shape the client module system
 *    scans, and every path it points at exists;
 * 2. the Node loader entry imports, exports `apply`, and ships the layer-B
 *    server page/process it starts;
 * 3. the browser bundle is a valid closure-factory artifact: it registers one
 *    factory under the package name, materializes with only `react` /
 *    `react/jsx-runtime` requested, and `apply()` contributes exactly the two
 *    slot entries the panel needs (including the injected stylesheet);
 * 4. the typed sources type-check against the harness's TypeScript, React, and
 *    Node types (the host entry now starts the packaged preview server).
 *
 * It does not prove the panel renders: that needs a booted Web GUI and is
 * covered by the browser check in README.md.
 *
 * Usage: node scripts/verify.mjs
 * @module dsh-artcraft-preview-panel/scripts/verify
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { resolveTypeScript } from './lib/toolchain.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0

/**
 * Record one check.
 * @param label - what was checked.
 * @param condition - the outcome.
 * @param detail - optional failure detail.
 */
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok      ${label}`)
    return
  }
  failures += 1
  console.log(`FAIL    ${label}${detail === undefined ? '' : `: ${detail}`}`)
}

/** Structural equality for JSON-shaped values. */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const manifestPath = join(packageRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

// ── manifest and patch ──────────────────────────────────────────────────────

check('manifest: name is dsh-artcraft-preview-panel', manifest.name === 'dsh-artcraft-preview-panel', String(manifest.name))
check('manifest: dsh.client.platform is "web"', manifest.dsh?.client?.platform === 'web', String(manifest.dsh?.client?.platform))
check(
  'manifest: dsh.client.inject names the two slot owners',
  sameJson(manifest.dsh?.client?.inject, ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar']),
  JSON.stringify(manifest.dsh?.client?.inject),
)
const patchRel = manifest.dsh?.bundle?.patch
const patchPath = typeof patchRel === 'string' ? join(packageRoot, patchRel) : undefined
check('manifest: dsh.bundle.patch resolves', patchPath !== undefined && existsSync(patchPath), String(patchRel))
const hostRel = manifest.exports?.['.']
const hostPath = typeof hostRel === 'string' ? join(packageRoot, hostRel) : undefined
check('manifest: exports["."] resolves', hostPath !== undefined && existsSync(hostPath), String(hostRel))
const clientExport = manifest.exports?.['./client']
const clientRel = typeof clientExport === 'string' ? clientExport : clientExport?.default
const clientPath = typeof clientRel === 'string' ? join(packageRoot, clientRel) : undefined
check('manifest: exports["./client"] resolves', clientPath !== undefined && existsSync(clientPath), String(clientRel))

if (patchPath !== undefined && existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  check(
    'patch: one insert row naming the package',
    /^- insert:\s*$/mu.test(patch) && patch.includes(`name: "${manifest.name}"`),
    patch.trim().slice(0, 160),
  )
}

// ── host entry ──────────────────────────────────────────────────────────────

if (hostPath !== undefined && existsSync(hostPath)) {
  try {
    const host = await import(pathToFileURL(hostPath).href)
    check('host entry: imports as ESM', true)
    check('host entry: exports apply()', typeof host.apply === 'function')
  } catch (error) {
    check('host entry: imports as ESM', false, error instanceof Error ? error.message : String(error))
  }
}

// The host half starts layer B from its packaged copy; importing alone must not
// spawn anything, so the server is checked by parsing, not by running it.
const packagedServer = join(packageRoot, 'server', 'server.mjs')
const packagedPanel = join(packageRoot, 'server', 'panel.html')
check(
  'host entry: ships the layer-B server and page',
  existsSync(packagedServer) && existsSync(packagedPanel),
  'run `node scripts/build.mjs` after editing src/index.ts',
)
if (existsSync(packagedServer) && existsSync(packagedPanel)) {
  try {
    execFileSync(process.execPath, ['--check', packagedServer], { stdio: 'pipe' })
    check('layer-B server: parses under this Node', true)
  } catch (error) {
    check('layer-B server: parses under this Node', false, error instanceof Error ? error.message : String(error))
  }
  check(
    'layer-B page: carries the panel marker',
    readFileSync(packagedPanel, 'utf8').includes('ArtCraft Live Preview'),
  )
  // The copy is refreshed by the build; drift against a checkout is a note, not
  // a failure, because layer B evolves independently of this package.
  const workspaceServer = resolve(packageRoot, '..', '..', 'scripts', 'preview', 'server.mjs')
  if (existsSync(workspaceServer)) {
    const current = readFileSync(workspaceServer).equals(readFileSync(packagedServer))
    console.log(`${current ? 'ok      ' : 'note    '} layer-B copy is ${current ? 'current with' : 'older than'} scripts/preview/server.mjs`)
  }
}

// ── browser bundle ──────────────────────────────────────────────────────────

if (clientPath !== undefined && existsSync(clientPath)) {
  const bundle = readFileSync(clientPath, 'utf8')
  try {
    // Compiles without executing; the registration line runs in the browser.
    // eslint-disable-next-line no-new-func
    new Function(bundle)
    check('bundle: parses as JavaScript', true)
  } catch (error) {
    check('bundle: parses as JavaScript', false, error instanceof Error ? error.message : String(error))
  }
  check(
    'bundle: closure-factory envelope',
    bundle.includes('window.__ModuleLoader__.load({') && bundle.includes('factory: (require) => {'),
  )

  const externalRequests = [...new Set(
    [...bundle.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1]),
  )].filter(specifier => !specifier.startsWith('.'))
  check(
    'bundle: requests only seeded platform modules',
    externalRequests.every(specifier => specifier === 'react' || specifier === 'react/jsx-runtime'),
    externalRequests.join(', '),
  )

  const loaded = []
  const styles = []
  const document = {
    querySelector(selector) {
      return styles.find(tag => selector.includes(`"${tag.dataset.pluginCss}"`)) ?? null
    },
    createElement(tag) {
      return { tag, dataset: {}, textContent: '' }
    },
    head: {
      appendChild(node) {
        styles.push(node)
      },
    },
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(registration) { loaded.push(registration) } } },
    document,
    console,
  }
  try {
    vm.runInNewContext(bundle, sandbox, { filename: 'lib/client.js' })
    check('bundle: executes its top-level registration', loaded.length === 1, `${String(loaded.length)} registrations`)
    const registration = loaded[0]
    check('bundle: registration id is the package name', registration?.id === manifest.name, String(registration?.id))

    const react = {
      createElement: () => null,
      useState: () => { throw new Error('no render expected during registration') },
      useEffect: () => {},
      useRef: () => ({ current: null }),
      Fragment: Symbol('Fragment'),
    }
    const jsxRuntime = { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    const requireStub = (specifier) => {
      if (specifier === 'react') return react
      if (specifier === 'react/jsx-runtime') return jsxRuntime
      throw new Error(`unexpected external request: ${String(specifier)}`)
    }
    const clientExports = registration.factory(requireStub)
    check('bundle: factory materializes', typeof clientExports === 'object' && clientExports !== null)
    check('bundle: exports apply()', typeof clientExports.apply === 'function')
    check('bundle: exports inject = ["slots"]', sameJson(clientExports.inject, ['slots']), JSON.stringify(clientExports.inject))

    const injected = []
    const registrations = []
    const ctx = {
      slots: {
        inject(key, factory) {
          injected.push(key)
          factory()
          return () => {}
        },
        register(options, component) {
          registrations.push({ options, component })
          return () => {}
        },
      },
    }
    clientExports.apply(ctx)
    check(
      'apply(): injects into main and sidebar.panellist',
      sameJson(injected, ['main', 'sidebar.panellist']),
      JSON.stringify(injected),
    )
    check(
      'apply(): main panel under the artcraft-preview key',
      registrations.some(entry => entry.options?.name === 'main'
        && entry.options?.key === 'artcraft-preview'
        && typeof entry.component === 'function'),
    )
    check(
      'apply(): sidebar launcher under the artcraft-preview id',
      registrations.some(entry => entry.options?.name === 'sidebar.panellist'
        && entry.options?.id === 'artcraft-preview'
        && typeof entry.options?.label === 'string'
        && typeof entry.component === 'function'),
    )
    check(
      'styles: one tagged stylesheet injected',
      styles.length === 1
        && styles[0]?.dataset?.plugin === manifest.name
        && typeof styles[0]?.textContent === 'string'
        && styles[0].textContent.includes('.acp-root'),
    )
  } catch (error) {
    check('bundle: materializes and applies', false, error instanceof Error ? error.stack ?? error.message : String(error))
  }
}

// ── type check ──────────────────────────────────────────────────────────────

let toolchain
try {
  toolchain = resolveTypeScript(packageRoot)
} catch (error) {
  check('type-check: TypeScript compiler found', false, error instanceof Error ? error.message : String(error))
}

if (toolchain !== undefined) {
  const { ts } = toolchain
  const typesRoot = join(dirname(toolchain.directory), '@types')
  const reactTypes = join(typesRoot, 'react')
  const nodeTypes = join(typesRoot, 'node')
  if (!existsSync(reactTypes) || !existsSync(nodeTypes)) {
    check('type-check: @types/react and @types/node found next to the compiler', false, typesRoot)
  } else {
    const scratch = mkdtempSync(join(tmpdir(), 'dsh-artcraft-preview-typecheck-'))
    let diagnosticsReported = false
    try {
      // `paths` substitutes relative to the tsconfig's own directory; the
      // scratch config lives in tmp, so measure from there.
      const reactRelative = relative(scratch, reactTypes).split(sep).join('/')
      const typesRelative = relative(scratch, typesRoot).split(sep).join('/')
      /**
       * Run one program and report its diagnostics.
       * @param label - check label prefix.
       * @param fileName - config file name inside the scratch directory.
       * @param config - tsconfig JSON.
       */
      const runTypeCheck = (label, fileName, config) => {
        const configPath = join(scratch, fileName)
        writeFileSync(configPath, JSON.stringify(config, undefined, 2))
        const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
        if (configFile.error !== undefined) {
          check(`${label}: tsconfig parses`, false, ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'))
          return
        }
        const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, scratch)
        const program = ts.createProgram(parsed.fileNames, parsed.options)
        const diagnostics = ts.getPreEmitDiagnostics(program)
        if (diagnostics.length === 0) {
          check(`${label}: 0 diagnostics (TypeScript ${ts.version})`, true)
          return
        }
        diagnosticsReported = true
        check(`${label}: 0 diagnostics`, false, `\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: file => file,
          getCurrentDirectory: () => packageRoot,
          getNewLine: () => '\n',
        })}`)
      }

      // Browser half: DOM globals, React types, no Node globals.
      runTypeCheck('type-check (client)', 'tsconfig.client.json', {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          paths: {
            react: [reactRelative],
            'react/*': [`${reactRelative}/*`],
          },
        },
        files: [join(packageRoot, 'src/client.tsx')],
      })

      // Host half: Node globals; it starts the packaged preview server.
      runTypeCheck('type-check (host)', 'tsconfig.host.json', {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
          typeRoots: [typesRelative],
        },
        files: [join(packageRoot, 'src/index.ts')],
      })
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
    if (diagnosticsReported) console.error('verify: type diagnostics were printed above')
  }
}

// ── summary ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nverify: ${String(failures)} check(s) failed`)
  process.exit(1)
}
console.log('\nverify: all checks passed')
