#!/usr/bin/env node
/**
 * ArtCraft live preview — layer B.
 *
 * A dependency-free, read-only HTTP server over the preview state directory
 * described in `docs/PREVIEW.md`: it serves the panel, merges `index.json` with
 * every `<craft>/state.json`, streams change events over SSE, and hands out the
 * rendered PNGs. It never writes to the preview directory and binds loopback
 * only, so it is safe to leave running while an agent works.
 *
 * Usage:
 *   node scripts/preview/server.mjs [--port 4177] [--dir PATH] [--open]
 *
 * `--open` prints the URL instead of launching a browser (this server never
 * launches one).
 * @module scripts/preview/server
 */

import { createReadStream, existsSync, watch } from 'node:fs'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL_FILE = join(HERE, 'panel.html')
const HOST = '127.0.0.1'
const DEFAULT_PORT = 4177
const STREAM_HEARTBEAT_MS = 20_000
const WATCH_DEBOUNCE_MS = 80

const DSH_HOME = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const DEFAULT_DIR = process.env.DSH_ARTCRAFT_PREVIEW_DIR?.trim() || join(DSH_HOME, 'artcraft', 'preview')

const PRODUCT_NAMES = {
  wordcraft: 'WordCraft',
  deckcraft: 'DeckCraft',
  designcraft: 'DesignCraft',
  pdfcraft: 'PdfCraft',
  cadcraft: 'CADCraft',
  vectorcraft: 'VectorCraft',
  photocraft: 'PhotoCraft',
  lightcraft: 'LightCraft',
  filmcraft: 'FilmCraft',
  effectcraft: 'EffectCraft',
  soundcraft: 'SoundCraft',
  gridcraft: 'GridCraft',
  texturecraft: 'TextureCraft',
  figcraft: 'FigCraft',
}

/** Extensions the panel may display. Renders are PNG; the rest are tolerated. */
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
])

/** One path segment from the state directory: no dots-only, slashes, or NUL. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Server': 'artcraft-preview',
}

const PANEL_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  // The DSH Web GUI embeds this panel on another loopback port, so framing is
  // allowed between loopback origins only; remote pages are still refused.
  "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
].join('; ')

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function usage() {
  return [
    'ArtCraft live preview server (read-only, loopback only)',
    '',
    'Usage: node scripts/preview/server.mjs [options]',
    '',
    'Options:',
    `  --port <n>      port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)`,
    `  --dir <path>    preview state directory (default $DSH_HOME/artcraft/preview,`,
    `                  or ${DEFAULT_DIR})`,
    '  --open          print the panel URL instead of launching a browser',
    '  -h, --help      show this help',
    '',
    'Environment:',
    '  DSH_HOME                    DSH home directory (default ~/.dsh)',
    '  DSH_ARTCRAFT_PREVIEW_DIR    overrides the default preview directory',
  ].join('\n')
}

function fail(message) {
  console.error(`preview: ${message}\n\n${usage()}`)
  process.exit(2)
}

function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, dir: DEFAULT_DIR, open: false, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('-')) fail(`unexpected argument: ${argument}`)

    const equals = argument.indexOf('=')
    const flag = equals === -1 ? argument : argument.slice(0, equals)
    const inline = equals === -1 ? undefined : argument.slice(equals + 1)

    switch (flag) {
      case '--port':
      case '-p': {
        const value = inline ?? argv[++index]
        if (value === undefined) fail('--port needs a value')
        if (!/^\d+$/.test(value)) fail(`--port must be an integer, got ${JSON.stringify(value)}`)
        const port = Number(value)
        if (port > 65_535) fail(`--port must be between 0 and 65535, got ${port}`)
        options.port = port
        break
      }
      case '--dir':
      case '-d': {
        const value = inline ?? argv[++index]
        if (value === undefined || value === '') fail('--dir needs a path')
        options.dir = resolve(expandHome(value))
        break
      }
      case '--open':
        if (inline !== undefined) fail('--open takes no value')
        options.open = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        fail(`unknown option: ${argument}`)
    }
  }

  options.dir = resolve(options.dir)
  return options
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const asString = value => (typeof value === 'string' && value.trim() !== '' ? value : null)
const asNumber = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  return null
}

function productFor(craft) {
  return PRODUCT_NAMES[craft] ?? craft.replace(/(^|[-_])([a-z])/g, (_, lead, letter) => `${lead ? ' ' : ''}${letter.toUpperCase()}`)
}

function isSafeSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && SAFE_SEGMENT.test(value)
}

/** A render filename is relative to `<craft>/`; allow subdirectories, refuse escapes. */
function isSafeRelative(value) {
  if (typeof value !== 'string' || value === '' || value.length > 1024) return false
  if (value.includes('\\') || value.includes('\u0000')) return false
  const segments = value.split('/')
  return segments.every(segment => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\u0000'))
}

function assetUrl(craft, relative) {
  const segments = [craft, ...relative.split('/')]
  return `/img/${segments.map(encodeURIComponent).join('/')}`
}

function nowIso() {
  return new Date().toISOString()
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJsonFile(file, warnings) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') warnings.push(`${file}: ${error.message}`)
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    warnings.push(`${file}: invalid JSON (${error.message})`)
    return null
  }
}

// ---------------------------------------------------------------------------
// State merge
// ---------------------------------------------------------------------------

function normalizeStep(craft, raw, index) {
  const step = isObject(raw) ? raw : {}
  const number = asNumber(step.n)
  const n = number === null ? index + 1 : number
  const image = isSafeRelative(step.image) ? step.image : null
  // A thumb may be omitted; the 112px filmstrip cell can use the full render,
  // but the contract asks for <=320px thumbs so prefer the real thumb when given.
  const thumb = isSafeRelative(step.thumb) ? step.thumb : image

  return {
    ...step,
    n,
    at: asString(step.at),
    tool: asString(step.tool),
    title: asString(step.title),
    summary: asString(step.summary),
    image,
    thumb,
    imageUrl: image === null ? null : assetUrl(craft, image),
    thumbUrl: thumb === null ? null : assetUrl(craft, thumb),
    width: asNumber(step.width),
    height: asNumber(step.height),
    durationMs: (() => {
      const duration = asNumber(step.durationMs)
      return duration === null || duration < 0 ? null : Math.round(duration)
    })(),
    timeline: normalizeTimeline(step.timeline),
  }
}

function normalizeTimeline(raw) {
  if (!Array.isArray(raw)) return null
  const clips = []
  raw.forEach((item, index) => {
    if (!isObject(item)) return
    const start = asNumber(item.start)
    const duration = asNumber(item.duration)
    if (start === null || start < 0 || duration === null || duration <= 0) return
    clips.push({
      ...item,
      start,
      duration,
      label: asString(item.label) ?? `clip ${index + 1}`,
      ...(asString(item.status) === null ? {} : { status: item.status }),
    })
  })
  return clips.sort((a, b) => a.start - b.start)
}

/**
 * The contract describes `timeline` as a property of `state.json`; the craft-kit
 * writer also allows it on a step. Accept both, preferring the current step.
 */
function pickTimeline(base, steps) {
  const top = normalizeTimeline(base.timeline)
  if (top !== null && top.length > 0) return top
  const current = asNumber(base.current)
  const chosen = steps.find(step => step.n === current && step.timeline !== null)
    ?? [...steps].reverse().find(step => step.timeline !== null)
  const fromStep = chosen?.timeline ?? null
  if (fromStep !== null && fromStep.length > 0) return fromStep
  return top
}

function mergeCraft(name, indexed, state, warnings) {
  const base = { ...(isObject(indexed) ? indexed : {}), ...(isObject(state) ? state : {}) }
  const steps = Array.isArray(base.steps)
    ? base.steps.map((step, index) => normalizeStep(name, step, index))
    : []

  if (isObject(state) && state.steps !== undefined && !Array.isArray(state.steps)) {
    warnings.push(`${name}/state.json: "steps" is not an array`)
  }

  const stepCount = steps.length > 0 ? steps.length : Math.max(steps.length, asNumber(base.stepCount) ?? 0)
  let current = asNumber(base.current)
  if (current !== null && steps.length > 0 && !steps.some(step => step.n === current)) {
    current = steps[steps.length - 1].n
  }
  if (current === null && steps.length > 0) current = steps[steps.length - 1].n

  return {
    ...base,
    craft: name,
    product: asString(base.product) ?? productFor(name),
    file: asString(base.file),
    pages: asNumber(base.pages),
    stepCount,
    current,
    steps,
    updatedAt: asString(base.updatedAt),
    timeline: pickTimeline(base, steps),
    hasState: isObject(state),
    imageCount: steps.filter(step => step.imageUrl !== null).length,
  }
}

async function collectState() {
  const warnings = []
  const index = await readJsonFile(join(previewRoot, 'index.json'), warnings)
  const indexedCrafts = isObject(index?.crafts) ? index.crafts : {}
  const directoryNames = await (async () => {
    try {
      return (await readdir(previewRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`${previewRoot}: ${error.message}`)
      return []
    }
  })()

  const names = new Set()
  for (const name of Object.keys(indexedCrafts)) {
    if (isSafeSegment(name)) names.add(name)
    else warnings.push(`index.json: ignoring unsafe craft name ${JSON.stringify(name)}`)
  }
  for (const name of directoryNames) {
    if (!isSafeSegment(name)) continue
    if (await pathExists(join(previewRoot, name, 'state.json'))) names.add(name)
  }

  const crafts = {}
  for (const name of [...names].sort()) {
    const indexed = isObject(indexedCrafts[name]) ? indexedCrafts[name] : {}
    const state = await readJsonFile(join(previewRoot, name, 'state.json'), warnings)
    crafts[name] = mergeCraft(name, indexed, state, warnings)
  }

  const stamps = [asString(index?.updatedAt), ...Object.values(crafts).map(craft => craft.updatedAt)]
    .filter(value => value !== null)
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value))
  const updatedAt = stamps.length > 0 ? new Date(Math.max(...stamps)).toISOString() : null

  return {
    version: 1,
    generatedAt: nowIso(),
    previewDir: previewRoot,
    rootExists: existsSync(previewRoot),
    updatedAt,
    crafts,
    warnings: warnings.slice(0, 50),
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function hostIsLoopback(request) {
  const host = request.headers.host
  if (host === undefined) return true
  try {
    return LOOPBACK_NAMES.has(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

/** A page from another origin must not be able to read this local view. */
function originIsLoopback(request) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return LOOPBACK_NAMES.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

/**
 * Layer C (the DSH client plugin) lives on a different loopback port and reads
 * `/state` with `fetch`, which needs CORS. Keep the grant to loopback origins:
 * a remote page still gets a 403 above.
 */
function applyCors(request, response) {
  const origin = request.headers.origin
  if (origin === undefined || !originIsLoopback(request)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  return true
}

function send(req, res, status, headers, body) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers })
  if (req.method === 'HEAD' || body === undefined) {
    res.end()
    return
  }
  res.end(body)
}

function sendJson(req, res, status, value, headers = {}) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  send(req, res, status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  }, body)
}

function sendText(req, res, status, message, headers = {}) {
  const body = `${message}\n`
  send(req, res, status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  }, body)
}

// ---------------------------------------------------------------------------
// Server-Sent Events
// ---------------------------------------------------------------------------

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set()
let broadcastTimer = null
let closing = false

function writeEvent(response, payload) {
  if (response.writableEnded) return
  try {
    response.write(`data: ${JSON.stringify(payload)}\n\n`)
  } catch {
    clients.delete(response)
  }
}

function broadcast(reason) {
  const payload = { type: 'update', reason, at: nowIso() }
  for (const response of [...clients]) writeEvent(response, payload)
}

function scheduleBroadcast(reason) {
  if (closing) return
  clearTimeout(broadcastTimer)
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcast(reason)
  }, WATCH_DEBOUNCE_MS)
  broadcastTimer.unref?.()
}

function openEventStream(req, res) {
  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  res.write('retry: 1500\n\n')
  writeEvent(res, { type: 'hello', at: nowIso(), previewDir: previewRoot })
  clients.add(res)

  const heartbeat = setInterval(() => {
    if (res.writableEnded) return
    try {
      res.write(': ping\n\n')
    } catch {
      clients.delete(res)
    }
  }, STREAM_HEARTBEAT_MS)
  heartbeat.unref()

  const cleanup = () => {
    clearInterval(heartbeat)
    clients.delete(res)
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}

// ---------------------------------------------------------------------------
// Directory watching
// ---------------------------------------------------------------------------

let rootWatcher = null
const childWatchers = new Map()
let watchRetry = null

function stopWatchers() {
  if (rootWatcher !== null) {
    try {
      rootWatcher.close()
    } catch {}
    rootWatcher = null
  }
  for (const watcher of childWatchers.values()) {
    try {
      watcher.close()
    } catch {}
  }
  childWatchers.clear()
}

function retryWatcher(message) {
  if (closing || watchRetry !== null) return
  if (message !== undefined) console.error(`preview: ${message}`)
  watchRetry = setTimeout(() => {
    watchRetry = null
    void startWatcher()
  }, 1000)
  watchRetry.unref()
}

async function syncChildWatchers() {
  let names
  try {
    names = (await readdir(previewRoot, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return
  }

  for (const [name, watcher] of childWatchers) {
    if (!names.includes(name)) {
      try {
        watcher.close()
      } catch {}
      childWatchers.delete(name)
    }
  }

  for (const name of names) {
    if (!isSafeSegment(name) || childWatchers.has(name)) continue
    try {
      const watcher = watch(join(previewRoot, name), () => scheduleBroadcast(`change:${name}`))
      watcher.on('error', () => {
        try {
          watcher.close()
        } catch {}
        childWatchers.delete(name)
        scheduleBroadcast(`rescan:${name}`)
      })
      childWatchers.set(name, watcher)
    } catch {}
  }
}

async function startWatcher() {
  if (closing || rootWatcher !== null) return
  if (!existsSync(previewRoot)) {
    retryWatcher()
    return
  }

  try {
    // macOS/Windows support recursive watch; Linux supports it on Node >= 20.
    const watcher = watch(previewRoot, { recursive: true }, () => scheduleBroadcast('change'))
    watcher.on('error', error => {
      stopWatchers()
      retryWatcher(`watch error: ${error.message}`)
    })
    rootWatcher = watcher
    // The root may have appeared after the first client connected; tell open
    // streams to re-read once the watcher is actually attached.
    scheduleBroadcast('watch')
    return
  } catch {
    // Fall back to watching the root (index.json) and one watcher per craft.
  }

  try {
    const watcher = watch(previewRoot, () => {
      void syncChildWatchers()
      scheduleBroadcast('change')
    })
    watcher.on('error', error => {
      stopWatchers()
      retryWatcher(`watch error: ${error.message}`)
    })
    rootWatcher = watcher
    await syncChildWatchers()
    scheduleBroadcast('watch')
  } catch (error) {
    retryWatcher(`cannot watch ${previewRoot}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function servePanel(req, res) {
  let html
  try {
    html = await readFile(PANEL_FILE, 'utf8')
  } catch (error) {
    sendText(req, res, 500, `panel.html is missing next to server.mjs (${error.message})`)
    return
  }
  send(req, res, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'Content-Security-Policy': PANEL_CSP,
  }, html)
}

async function serveImage(req, res, pathname) {
  const encoded = pathname.slice('/img/'.length)
  const encodedSegments = encoded.split('/')
  const segments = []
  for (const segment of encodedSegments) {
    try {
      segments.push(decodeURIComponent(segment))
    } catch {
      sendText(req, res, 400, 'Malformed image path')
      return
    }
  }

  const unsafe = segments.some(segment =>
    segment === '' || segment === '.' || segment === '..' || segment.includes('/') ||
    segment.includes('\\') || segment.includes('\u0000'))
  if (unsafe || segments.length < 2) {
    sendText(req, res, 403, 'Forbidden')
    return
  }

  const [craft, ...fileSegments] = segments
  if (!isSafeSegment(craft)) {
    sendText(req, res, 403, 'Forbidden')
    return
  }

  const type = IMAGE_TYPES.get(extname(fileSegments[fileSegments.length - 1]).toLowerCase())
  if (type === undefined) {
    sendText(req, res, 415, 'Only image renders are served')
    return
  }

  let rootReal
  try {
    rootReal = await realpath(previewRoot)
  } catch {
    sendText(req, res, 404, 'Preview directory does not exist yet')
    return
  }

  const craftRoot = resolve(rootReal, craft)
  const target = resolve(craftRoot, ...fileSegments)
  if (target !== craftRoot && !target.startsWith(`${craftRoot}${sep}`)) {
    sendText(req, res, 403, 'Forbidden')
    return
  }

  let realTarget
  try {
    realTarget = await realpath(target)
  } catch {
    sendText(req, res, 404, 'Not found')
    return
  }
  // Symlinks must not lead out of the preview root.
  if (!realTarget.startsWith(`${rootReal}${sep}`)) {
    sendText(req, res, 403, 'Forbidden')
    return
  }

  let info
  try {
    info = await stat(realTarget)
  } catch {
    sendText(req, res, 404, 'Not found')
    return
  }
  if (!info.isFile()) {
    sendText(req, res, 404, 'Not found')
    return
  }

  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
    'Last-Modified': info.mtime.toUTCString(),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }

  const stream = createReadStream(realTarget)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

async function handleRequest(req, res) {
  if (!hostIsLoopback(req) || !originIsLoopback(req)) {
    sendText(req, res, 403, 'Loopback hosts only')
    return
  }

  const cors = applyCors(req, res)
  if (req.method === 'OPTIONS') {
    if (!cors) {
      sendText(req, res, 405, 'Read-only server: GET and HEAD only', { Allow: 'GET, HEAD' })
      return
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    const requested = req.headers['access-control-request-headers']
    if (requested !== undefined) res.setHeader('Access-Control-Allow-Headers', requested)
    res.setHeader('Access-Control-Max-Age', '600')
    send(req, res, 204, { 'Cache-Control': 'no-store' })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(req, res, 405, 'Read-only server: GET and HEAD only', { Allow: 'GET, HEAD' })
    return
  }

  let pathname
  try {
    pathname = new URL(req.url ?? '/', `http://${HOST}`).pathname
  } catch {
    sendText(req, res, 400, 'Bad request')
    return
  }

  if (pathname === '/') {
    await servePanel(req, res)
    return
  }
  if (pathname === '/state') {
    sendJson(req, res, 200, await collectState())
    return
  }
  if (pathname === '/events') {
    openEventStream(req, res)
    return
  }
  if (pathname.startsWith('/img/')) {
    await serveImage(req, res, pathname)
    return
  }
  if (pathname === '/favicon.ico') {
    send(req, res, 204, { 'Cache-Control': 'no-store' })
    return
  }

  sendText(req, res, 404, 'Not found')
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage())
  process.exit(0)
}

const previewRoot = options.dir
let closingDown = false

const server = createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(`preview: request failed: ${error.stack ?? error.message}`)
    if (!res.headersSent) {
      sendText(req, res, 500, 'Internal preview server error')
    } else {
      res.destroy()
    }
  })
})

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`preview: port ${options.port} is already in use — pass --port <n>`)
  } else {
    console.error(`preview: server error: ${error.message}`)
  }
  process.exit(1)
})

function shutdown() {
  if (closingDown) return
  closingDown = true
  closing = true
  clearTimeout(broadcastTimer)
  broadcastTimer = null
  clearTimeout(watchRetry)
  watchRetry = null
  stopWatchers()
  for (const response of clients) {
    try {
      response.end()
    } catch {}
  }
  clients.clear()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(options.port, HOST, () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : options.port
  const url = `http://${HOST}:${port}/`
  const exists = existsSync(previewRoot)

  console.log('')
  console.log('ArtCraft live preview — layer B')
  console.log(`  panel   ${url}`)
  console.log(`  state   ${url}state`)
  console.log(`  events  ${url}events`)
  console.log(`  dir     ${previewRoot}${exists ? '' : '  (not created yet — waiting for the first render)'}`)
  if (options.open) console.log(`\n  --open: open ${url} in a browser (the server itself never launches one).`)
  console.log('\n  loopback only · read-only · Ctrl+C to stop\n')

  void startWatcher()
})
