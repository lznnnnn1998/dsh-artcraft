/**
 * An MCP (Model Context Protocol) client for a craft's own stdio server.
 *
 * Every craft ships `*-cli mcp`, a JSON-RPC 2.0 server with a modelled tool set
 * (GridCraft 21 tools, SoundCraft more) alongside the generic command strings
 * the CLI takes. Bridging to it gives the model tools with real JSON Schemas
 * instead of one `--cmd` string, which is why the plugins expose both.
 *
 * The server is spawned once per runtime and kept warm: starting GridCraft's
 * engine costs ~600 ms, which is too much to pay on every call. It is killed
 * after `idleMs` without a request, and again when the plugin unloads.
 * @module @dsh-artcraft/craft-kit/mcp
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { killTree } from './exec.ts'
import type { CraftBinary, CraftProfile } from './types.ts'

/** One tool as the MCP server declares it. */
export interface McpTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

/** A settled JSON-RPC response. */
interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** Default MCP protocol revision; servers negotiate down if they need to. */
const PROTOCOL_VERSION = '2024-11-05'

/**
 * One live MCP connection to a craft.
 *
 * Kept deliberately small: one process, one pending-request table, and a
 * close path that always kills the child, because a craft's engine holds
 * memory and a leaked server would outlive the session that started it.
 */
export class CraftMcpClient {
  readonly #profile: CraftProfile
  readonly #binary: CraftBinary
  readonly #args: readonly string[]
  #child: ChildProcessWithoutNullStreams | undefined
  #buffer = ''
  #nextId = 1
  readonly #pending = new Map<number, Pending>()
  #idleTimer: NodeJS.Timeout | undefined
  #handshake: Promise<{ name?: string; version?: string }> | undefined
  #tools: McpTool[] | undefined
  #closed = false

  constructor(profile: CraftProfile, binary: CraftBinary, args: readonly string[] = []) {
    this.#profile = profile
    this.#binary = binary
    this.#args = args
  }

  /** Whether a live server process is currently attached. */
  get running(): boolean {
    return this.#child !== undefined && this.#child.exitCode === null && !this.#closed
  }

  /** Tools the server declared, from the cached `tools/list` result. */
  get cachedTools(): readonly McpTool[] | undefined {
    return this.#tools
  }

  /** One-line description of how this client was started, for diagnostics. */
  describe(): string {
    return `${this.#binary.path} ${[...this.#args].join(' ')}`.trim()
  }

  /** Start the server if needed and complete the MCP handshake. */
  async start(idleMs: number): Promise<void> {
    if (this.#closed) throw new Error(`${this.#profile.product}: MCP client is closed`)
    if (this.running) return
    const child = spawn(this.#binary.path, [...(this.#profile.mcpArgs ?? ['mcp']), ...this.#args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
      // Keeps the long-lived server from flashing a console window on Windows.
      windowsHide: true,
    })
    this.#child = child
    this.#buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { this.#onData(chunk) })
    child.stderr.setEncoding('utf8')
    // Craft servers announce themselves on stderr; it is not an error stream.
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text.length > 0 && process.env.DSH_ARTCRAFT_TRACE !== undefined) {
        process.stderr.write(`[${this.#profile.id} mcp] ${text}\n`)
      }
    })
    child.on('exit', () => {
      this.#child = undefined
      for (const [, pending] of this.#pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`${this.#profile.product}: MCP server exited`))
      }
      this.#pending.clear()
    })
    child.on('error', (error) => {
      this.#child = undefined
      for (const [, pending] of this.#pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`${this.#profile.product}: MCP server failed to start: ${error.message}`))
      }
      this.#pending.clear()
    })
    this.#idleMs = idleMs
    await this.#request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-artcraft', version: '0.1.0' },
    })
    this.#notify('notifications/initialized', {})
  }

  #idleMs = 300_000

  /** Walk the server's tool list, caching it for later calls. */
  async listTools(): Promise<McpTool[]> {
    if (this.#tools !== undefined) return [...this.#tools]
    const result = await this.#request('tools/list', {}) as { tools?: McpTool[] }
    this.#tools = Array.isArray(result.tools) ? result.tools : []
    return [...this.#tools]
  }

  /**
   * Call one tool.
   * @param name - tool name as declared by the server.
   * @param args - the tool's JSON arguments.
   * @returns the concatenated text content of the result.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.#request('tools/call', { name, arguments: args }) as {
      content?: { type?: string; text?: string }[]
      isError?: boolean
    }
    const text = (result.content ?? [])
      .map(block => (block.type === 'text' ? block.text ?? '' : `[${block.type ?? 'unknown'} content]`))
      .join('\n')
      .trim()
    return `${text.length > 0 ? text : '(no content)'}${result.isError === true ? '\n[mcp: tool reported an error]' : ''}`
  }

  /** Terminate the server process now. */
  close(): void {
    this.#closed = true
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer)
    const child = this.#child
    this.#child = undefined
    // `killTree` rather than `child.kill`: on Windows the craft server's own
    // helper processes are not in a process group and would otherwise survive.
    if (child !== undefined && child.exitCode === null) killTree(child)
  }

  /** Buffer stdout and resolve one response per complete line. */
  #onData(chunk: string): void {
    this.#buffer += chunk
    let index: number
    while ((index = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, index).trim()
      this.#buffer = this.#buffer.slice(index + 1)
      if (line.length === 0) continue
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        continue // A craft may log to stdout; only JSON-RPC lines matter.
      }
      if (typeof message.id !== 'number') continue
      const pending = this.#pending.get(message.id)
      if (pending === undefined) continue
      this.#pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error !== undefined) pending.reject(new Error(message.error.message ?? 'MCP error'))
      else pending.resolve(message.result)
    }
  }

  /** Send one request and await its response, arming the idle timer. */
  #request(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    const child = this.#child
    if (child === undefined || child.exitCode !== null) {
      return Promise.reject(new Error(`${this.#profile.product}: MCP server is not running`))
    }
    const id = this.#nextId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${this.#profile.product}: MCP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.#pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      this.#armIdle()
    })
  }

  /** Send a notification, which has no response. */
  #notify(method: string, params: unknown): void {
    this.#child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
    this.#armIdle()
  }

  /** (Re)start the countdown that shuts an unused server down. */
  #armIdle(): void {
    if (this.#idleTimer !== undefined) clearTimeout(this.#idleTimer)
    this.#idleTimer = setTimeout(() => { this.close() }, this.#idleMs)
    this.#idleTimer.unref?.()
  }
}

/**
 * Render an MCP tool's JSON Schema as a compact parameter grammar for the model.
 * @param schema - the tool's `inputSchema`.
 * @returns one line per property, or `(no parameters)`.
 */
export function renderSchema(schema: Record<string, unknown> | undefined): string {
  const properties = schema?.properties
  if (typeof properties !== 'object' || properties === null) return '(no parameters)'
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [])
  return Object.entries(properties as Record<string, { type?: string; description?: string; enum?: unknown[] }>)
    .map(([name, node]) => {
      const type = node.type ?? (Array.isArray(node.enum) ? 'enum' : 'value')
      const enumText = Array.isArray(node.enum) ? ` (${node.enum.map(e => JSON.stringify(e)).join(' | ')})` : ''
      return `  ${name}${required.has(name) ? '' : '?'}: ${type}${enumText}${node.description !== undefined ? ` — ${node.description}` : ''}`
    })
    .join('\n')
}
