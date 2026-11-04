/**
 * Build the model-facing tool set for one craft.
 *
 * This module returns plain descriptors plus the `defineTool` option objects.
 * The calling plugin (which does import `@deepseek-ai/dsh-tools`) turns them
 * into registered tools; the kernel itself stays free of DSH runtime imports
 * so it can be exercised by the verifier and the MCP bridge too.
 * @module @dsh-artcraft/craft-kit/tools
 */

import { craftCallView, craftResultView } from './present.ts'
import { canPreview, discardRender, lastStepHash, nextStepNumber, pageCount, previewRoot, recordPreview, renderPreview, stepName } from './preview.ts'
import { workflowsOf } from './suite.ts'
import { appendJournal } from './journal.ts'
import { CraftMcpClient, renderSchema } from './mcp.ts'
import type { McpTool } from './mcp.ts'
import { groupsOf, loadCatalog, score } from './catalog.ts'
import { craftVersion, discoverCraft, missingBinaryMessage } from './discover.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_TIMEOUT_MS, buildRunArgv, killTree, runCraft, startCraftJob } from './exec.ts'
import type { CraftCommandInput, CraftJobState } from './exec.ts'
import type { CraftBinary, CraftCommand, CraftProfile, CraftRunResult } from './types.ts'

/**
 * Decide which document a run starts from.
 *
 * An explicit model choice always wins — `sample: true` means "start a new
 * document" even on crafts that would otherwise wait to be told. Only when the
 * model said nothing does the craft default apply: crafts whose document is a
 * real input start from their built-in sample, crafts that open documents
 * through commands (PdfCraft, PhotoCraft) get no source flag at all, and a
 * sample flag that requires a value is never invented.
 *
 * `sample: true` on a craft with no sample flag is an error rather than a
 * silent no-op, because the caller asked for something the craft cannot do.
 * @param profile - the craft being driven.
 * @param args - the model's tool arguments.
 * @returns the sample selection, or `undefined` to send no source flag.
 */
function resolveSample(profile: CraftProfile, args: Record<string, unknown>): string | boolean | undefined {
  const requested = args.sample
  if (typeof requested === 'string' && requested.length > 0) return requested
  if (requested === true) {
    // A craft that starts a new document by default, or creates one itself,
    // has nothing to select; asking for the sample is a harmless no-op.
    if (profile.run.sampleFlag.length === 0 && (profile.run.sampleCreate !== undefined || profile.run.scriptFile !== undefined)) return undefined
    if (profile.run.sampleFlag.length === 0) {
      throw new Error(
        `${profile.product} has no "new document" flag: pass \`input\` to open an existing document, `
        + `or use a command such as file.new in \`commands\` to start one.`,
      )
    }
    return true
  }
  if (args.input !== undefined) return undefined
  const inputMode = profile.run.inputMode ?? (profile.run.inFlag.length > 0 ? 'flag' : 'none')
  if (inputMode === 'none') return undefined
  if (profile.run.sampleFlag.length === 0) return undefined
  if (profile.run.samples !== undefined) return undefined
  if (profile.run.newSampleValue !== undefined) return undefined
  return true
}

/**
 * Flags that must precede the subcommand.
 *
 * FilmCraft is the one craft that works this way: its script mode writes the
 * project with the global `--save-as FILE`, so `filmcraft-cli --save-as out.fcproj
 * run script.jsonl`. Without a `save` path the flag is omitted entirely — a
 * placeholder here would create a file literally named after it.
 * @param profile - the craft being driven.
 * @param args - the model's tool arguments.
 * @returns flags to place before the subcommand, possibly empty.
 */
function globalFlagsFor(profile: CraftProfile, args: Record<string, unknown>): string[] {
  const save = typeof args.save === 'string' && args.save.length > 0 ? args.save : undefined
  if (profile.run.scriptMode === true && profile.run.saveFlag.length > 0 && save !== undefined) {
    return [profile.run.saveFlag, save]
  }
  return []
}

/**
 * Pull the parameter grammar out of a craft's `describe` output.
 *
 * Crafts disagree on shape: SoundCraft and DesignCraft print `{"params": "…"}`,
 * so the JSON field wins when present and the raw text is used otherwise.
 * @param stdout - the describe command's stdout.
 * @returns the grammar, or `undefined` when the output declares none.
 */
function extractParams(stdout: string): string | undefined {
  const text = stdout.trim()
  if (text.length === 0) return undefined
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { params?: unknown }
      if (typeof parsed.params === 'string' && parsed.params.length > 0) return parsed.params
    } catch {
      // Fall through to the line scan below.
    }
  }
  const match = /^\s*params:\s*(.+)$/m.exec(text)
  return match?.[1]?.trim()
}

/** Scratch directory for files the kernel generates per craft (script modes). */
function craftWorkDir(profile: CraftProfile): string {
  return join(tmpdir(), 'dsh-artcraft', profile.id)
}

/** Plugin configuration shared by every craft plugin. */
export interface CraftPluginConfig {
  /** Absolute path to the craft CLI; overrides discovery. */
  path?: string
  /** Per-call wall-clock budget in milliseconds. */
  timeoutMs?: number
  /**
   * Register the tools even when the binary is missing (default true). The
   * tools then answer with exact installation guidance instead of vanishing,
   * which makes the failure visible to the model.
   */
  registerWhenMissing?: boolean
  /** Cap on commands returned by the catalog tool (default 60). */
  catalogLimit?: number
  /**
   * Bridge to the craft's own MCP server (default true). The server's tools
   * carry real JSON Schemas, so they complement the generic `--cmd` surface.
   */
  enableMcp?: boolean
  /** Shut the MCP server down after this many idle milliseconds (default 300000). */
  mcpIdleMs?: number
}

/** Resolved runtime context shared by all tools of one craft. */
export interface CraftRuntime {
  readonly profile: CraftProfile
  readonly config: CraftPluginConfig
  /** Re-read discovery on each call so installing the CLI mid-session just works. */
  binary(): CraftBinary | undefined
  /** Human-readable reason the binary is unavailable. */
  unavailable(): string
  /** Cached catalog, invalidated with the binary. */
  catalog(): Promise<{ commands: readonly CraftCommand[]; origin: string; note?: string }>
  /**
   * The bridge to this craft's MCP server, created on first use.
   * @returns the client, or `undefined` when the craft ships no MCP server.
   */
  mcp(): CraftMcpClient | undefined
  /** Terminate the MCP server if one is running. */
  dispose(): void
}

/**
 * Build the shared runtime for one craft plugin instance.
 * @param profile - the craft to drive.
 * @param packageRoot - the plugin package root that may hold `catalog/<id>.json`.
 * @param config - plugin configuration.
 * @returns the runtime shared by every tool of this craft.
 */
export function createRuntime(profile: CraftProfile, packageRoot: string, config: CraftPluginConfig = {}): CraftRuntime {
  let catalogCache: { key: string; value: { commands: readonly CraftCommand[]; origin: string; note?: string } } | undefined
  const mcpClients = new Map<string, CraftMcpClient>()
  const artifacts = config.artifactsDir ?? join(tmpdir(), 'dsh-artcraft', profile.id)
  const previewDir = previewRoot(config.previewDir)
  let previewStep = 0
  const jobs = new Map<string, CraftJobState>()
  const jobChildren = new Map<string, import('node:child_process').ChildProcess>()
  let jobCounter = 0
  return {
    async preview(options) {
      if (config.preview === 'off') return undefined
      if (!canPreview(profile)) return undefined
      const binary = this.binary()
      if (binary === undefined) return undefined
      previewStep = nextStepNumber(previewDir, profile.id)
      const n = previewStep
      const dir = join(previewDir, profile.id)
      const out = join(dir, stepName(n))
      const scale = options.scale ?? config.previewScale ?? 1.5
      const previous = lastStepHash(previewDir, profile.id)

      // Render the first page, and when it did not change look at the last page:
      // appending a slide or typing on page 2 leaves page 1 identical, and a wall
      // of identical thumbnails is worse than no step at all.
      let rendered = await renderPreview(profile, binary, { file: options.file, dir, out, scale, page: 0 })
      let pages = 1
      if (rendered !== undefined && previous !== undefined && rendered.hash === previous) {
        pages = await pageCount(profile, binary, options.file)
        rendered = pages > 1
          ? await renderPreview(profile, binary, { file: options.file, dir, out, scale, page: pages - 1 })
          : undefined
        if (rendered !== undefined && rendered.hash === previous) rendered = undefined
      }
      if (rendered === undefined) {
        // Nothing visible changed; keep the step list meaningful by not adding one.
        discardRender(out)
        return undefined
      }
      recordPreview(previewDir, profile, {
        n,
        at: new Date().toISOString(),
        tool: options.tool,
        title: options.title,
        summary: options.summary,
        image: stepName(n),
        thumb: stepName(n),
        hash: rendered.hash,
        page: pages,
        ...options.durationMs === undefined ? {} : { durationMs: options.durationMs },
      }, options.file, pages)
      return rendered.path
    },
    startJob(binary, argv) {
      jobCounter += 1
      const id = `j${jobCounter}`
      const jobDir = join(artifacts, 'jobs')
      mkdirSync(jobDir, { recursive: true })
      const logPath = join(jobDir, `${profile.id}-${id}.log`)
      const started = startCraftJob({ profile, binary, argv, cwd: process.cwd(), logPath, id })
      const state: CraftJobState = { ...started, running: true, argv: started.argv, logPath, id, pid: started.pid, startedAt: started.startedAt }
      jobs.set(id, state)
      jobChildren.set(id, started.child)
      started.child.on('close', (code, signal) => {
        const settled: CraftJobState = {
          ...state, running: false, exitCode: code, signal,
          durationMs: Date.now() - state.startedAt,
        }
        jobs.set(id, settled)
        jobChildren.delete(id)
      })
      started.child.unref()
      return started
    },
    jobState(id) {
      return jobs.get(id)
    },
    jobs() {
      return [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)
    },
    async waitForJob(id, timeoutMs) {
      const state = jobs.get(id)
      if (state === undefined) return undefined
      const deadline = Date.now() + Math.max(0, timeoutMs)
      for (;;) {
        const current = jobs.get(id)
        if (current === undefined || !current.running) return current
        if (Date.now() >= deadline) return current
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    },
    killJob(id) {
      const child = jobChildren.get(id)
      if (child !== undefined) killTree(child)
      return child !== undefined
    },
    artifactsDir(): string {
      return artifacts
    },
    profile,
    config,
    mcp(attach?: number): CraftMcpClient | undefined {
      if (config.enableMcp === false) return undefined
      if (profile.mcpArgs === undefined) return undefined
      if (attach !== undefined && profile.mcpAttach === undefined) {
        throw new Error(`${profile.product} cannot attach to a running app: its MCP server is headless only`)
      }
      const binary = this.binary()
      if (binary === undefined) return undefined
      const args = [...profile.mcpSessionArgs ?? []]
      if (attach !== undefined && profile.mcpAttach !== undefined) {
        args.push(profile.mcpAttach.flag, profile.mcpAttach.format === 'hostPort' ? `127.0.0.1:${attach}` : String(attach))
      }
      const key = String(attach ?? '')
      const existing = mcpClients.get(key)
      // A CLI upgrade mid-session invalidates the running server.
      if (existing !== undefined && !existing.running && existing.cachedTools !== undefined) mcpClients.delete(key)
      const fresh = mcpClients.get(key) ?? new CraftMcpClient(profile, binary, args)
      mcpClients.set(key, fresh)
      return fresh
    },
    dispose(): void {
      for (const client of mcpClients.values()) client.close()
      mcpClients.clear()
    },
    binary(): CraftBinary | undefined {
      const found = discoverCraft(profile, config.path, packageRoot)
      if (found === undefined) return undefined
      return { ...found, version: craftVersion(found.path) }
    },
    unavailable(): string {
      return missingBinaryMessage(profile, config.path, packageRoot)
    },
    async catalog() {
      const binary = this.binary()
      const key = binary?.path ?? '(none)'
      if (catalogCache !== undefined && catalogCache.key === key) return catalogCache.value
      const loaded = await loadCatalog(profile, binary, packageRoot, config.timeoutMs ?? 30_000)
      const value = { commands: loaded.commands, origin: loaded.origin, ...loaded.note !== undefined ? { note: loaded.note } : {} }
      catalogCache = { key, value }
      return value
    },
  }
}

/** Render a finished run for both the model and the transcript. */
export function renderRun(result: CraftRunResult, profile: CraftProfile): string {
  const parts: string[] = []
  const head = `${profile.product} exited ${result.exitCode ?? `signal ${result.signal ?? '?'}`} in ${result.durationMs}ms`
  const body = [result.stdout.trim(), result.stderr.trim()].filter(part => part.length > 0).join('\n')
  parts.push(body.length > 0 ? `${body}\n${head}` : head)
  if (result.truncated) parts.push(`[output truncated at 256 KiB]`)
  return parts.join('\n')
}

/** Human-readable catalog listing, grouped by family. */
export function renderCatalog(
  profile: CraftProfile,
  commands: readonly CraftCommand[],
  origin: string,
  limit: number,
  query?: string,
): string {
  const needle = query?.trim().toLowerCase()
  let selected = commands
  if (needle !== undefined && needle.length > 0) {
    selected = commands
      .map(command => ({ command, weight: score(command, needle) }))
      .filter(entry => entry.weight > 0)
      .sort((a, b) => b.weight - a.weight || a.command.id.localeCompare(b.command.id))
      .map(entry => entry.command)
  }
  const shown = selected.slice(0, limit)
  const lines = [
    `${profile.product} command catalog (${origin}): ${selected.length}`
    + (selected.length > shown.length ? ` shown ${shown.length}` : '')
    + (needle !== undefined && needle.length > 0 ? ` matching ${JSON.stringify(query)}` : ''),
    `Families: ${groupsOf(commands).slice(0, 24).join(', ')}`,
    '',
  ]
  for (const command of shown) {
    const label = command.label !== undefined && command.label.length > 0 ? `  — ${command.label}` : ''
    const params = command.params !== undefined && command.params.length > 0 ? `\n      params: ${command.params}` : ''
    lines.push(`  ${command.id}${label}${params}`)
  }
  if (shown.length === 0) lines.push('  (no matching commands)')
  return lines.join('\n')
}

/** Every tool the craft contributes, as `defineTool`-ready descriptors. */
export interface CraftToolSet {
  readonly run: ToolSpec<'run'>
  readonly commands: ToolSpec<'commands'>
  readonly describe: ToolSpec<'describe'>
  readonly inspect?: ToolSpec<'inspect'>
  readonly convert?: ToolSpec<'convert'>
  /** Present only when the craft ships an MCP server. */
  readonly mcpTools?: ToolSpec<'mcpTools'>
  readonly mcpCall?: ToolSpec<'mcpCall'>
  readonly mcpStatus?: ToolSpec<'mcpStatus'>
  /** Background jobs started with `run` + `background: true`. */
  readonly job: ToolSpec<'job'>
}

/** One tool's definition: name/description/schema plus its executor and views. */
export interface ToolSpec<K extends string> {
  readonly kind: K
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly execute: (args: Record<string, unknown>) => Promise<string>
  /** Pending-call card: what this call is about to do. */
  readonly presentCall?: (args: Record<string, unknown>) => unknown
  /** Completed-call card: what the call produced. */
  readonly presentResult?: (args: Record<string, unknown>, text: string, isError: boolean) => unknown
}

/**
 * Normalize the model's `commands` argument into craft-agnostic pairs.
 * @param raw - the argument as supplied by the model.
 * @returns one { id, json } per entry, skipping anything unusable.
 */
function toCommandInputs(raw: unknown): CraftCommandInput[] {
  if (!Array.isArray(raw)) return []
  const out: CraftCommandInput[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      // A raw CLI string: split off the JSON argument if the model supplied one.
      const match = /^(\S+)\s+(.+)$/s.exec(entry.trim())
      if (match === null) { out.push({ id: entry.trim() }); continue }
      try {
        out.push({ id: match[1], json: JSON.parse(match[2]) })
      } catch {
        out.push({ id: match[1], json: match[2] })
      }
      continue
    }
    if (typeof entry === 'object' && entry !== null) {
      const record = entry as Record<string, unknown>
      const id = record.id
      if (typeof id !== 'string' || id.length === 0) continue
      const json = record.json ?? record.params ?? record.args
      out.push(json === undefined ? { id } : { id, json })
    }
  }
  return out
}

/** Read-only subcommand profile for the optional `inspect` tool. */
function readSpec(profile: CraftProfile, name: string): { verb: string; summary: string } | undefined {
  const found = profile.reads?.find(read => read.name === name)
  return found === undefined ? undefined : { verb: found.verb, summary: found.summary }
}

/**
 * Build the complete tool set for one craft.
 * @param runtime - the craft runtime (profile + discovery + catalog).
 * @returns tool descriptors; `inspect`/`convert` are absent when the craft has no such verb.
 */
export function createToolSet(runtime: CraftRuntime): CraftToolSet {
  const { profile, config } = runtime
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const catalogLimit = config.catalogLimit ?? 60

  /**
   * Run now, or start a background job when `background` is set.
   *
   * Renders, bakes and bounces outlast the tool timeout; a job keeps the process
   * alive after the call returns and leaves its output in a log file.
   */
  const runOrStart = async (
    binary: CraftBinary,
    argv: readonly string[],
    background: unknown,
    document?: string,
    label?: string,
  ): Promise<string> => {
    if (background === true) {
      const job = runtime.startJob(binary, argv)
      return [
        `started ${profile.id} job ${job.id}${job.pid === undefined ? '' : ` (pid ${job.pid})`}`,
        `log: ${job.logPath}`,
        `poll with \`${profile.id}_job\` {"action":"status","job":"${job.id}"}`,
        `or wait with {"action":"wait","job":"${job.id}","timeoutMs":300000}`,
      ].join('\n')
    }
    const result = await runCraft({ profile, binary, argv, cwd: process.cwd(), timeoutMs })
    let text = renderRun(result, profile)
    // A render after every write is what turns the transcript into a step-by-step
    // view of the document; the same image feeds the preview panel.
    if (result.ok && document !== undefined && config.preview !== 'off') {
      const rendered = await runtime.preview({
        file: document,
        tool: 'run',
        title: label === undefined || label.length === 0 ? `${profile.id}_run` : label,
        summary: `exit ${result.exitCode ?? 0} · ${result.durationMs} ms`,
        durationMs: result.durationMs,
      })
      if (rendered !== undefined) text += `\n[preview] ${rendered}`
    }
    return text
  }

  /** Guard every tool: a missing binary is an answer, never a crash. */
  const requireBinary = (): CraftBinary => {
    const binary = runtime.binary()
    if (binary === undefined) throw new Error(runtime.unavailable())
    return binary
  }

  /** One headless run of exactly one command, for crafts that cap it at one. */
  const runSingle = async (
    binary: CraftBinary,
    input: string | undefined,
    sample: string | boolean | undefined,
    commands: readonly CraftCommandInput[],
    background: unknown,
  ): Promise<string> => {
    const argv = buildRunArgv(profile, {
      ...input !== undefined ? { input } : {},
      ...sample !== undefined ? { sample } : {},
      commands,
    })
    return await runOrStart(binary, argv, background)
  }

  /** A short, human step label: the first command ids, not the tool name. */
  const labelOf = (args: Record<string, unknown>): string | undefined => {
    const raw = args.commands
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const ids = raw.map((entry) => {
      if (typeof entry === 'string') return entry.trim().split(/\s+/)[0] ?? ''
      if (typeof entry === 'object' && entry !== null) {
        const id = (entry as { id?: unknown }).id
        return typeof id === 'string' ? id : ''
      }
      return ''
    }).filter(id => id.length > 0)
    if (ids.length === 0) return undefined
    const shown = ids.slice(0, 3).join(', ')
    return `${profile.product} · ${ids.length <= 3 ? shown : `${shown} +${ids.length - 3}`}`
  }

  /** The document this call wrote or opened, when it named one. */
  const documentOf = (args: Record<string, unknown>): string | undefined => {
    for (const key of ['save', 'export', 'input'] as const) {
      const value = args[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return undefined
  }

  const session: CraftSession = { commands: [], stale: false }

  /**
   * Commands to send for this call: the recorded history first when the craft
   * needs one process, then the caller's new commands. A failing call clears
   * the history so the next call starts from a clean document.
   */
  const withSession = (commands: readonly CraftCommandInput[], reset: boolean): CraftCommandInput[] => {
    if (profile.oneToolPerRun !== true) return [...commands]
    if (reset) session.commands = []
    const merged = [...session.commands, ...commands]
    session.commands = merged
    return merged
  }

  const run: ToolSpec<'run'> = {
    kind: 'run',
    name: `${profile.id}_run`,
    description:
      `Run ${profile.product} headlessly. Loads a document (or the built-in sample), applies an ordered list of `
      + `commands, and optionally writes the document and/or an exported artifact. `
      + `Use \`${profile.id}_commands\` first to discover command ids and their parameters: `
      + `each entry here is { "id": "<command id>", "json": <its parameters> }, where "json" is `
      + (profile.run.positionalKeyValues === true
        ? `a flat object of the command's own argument names, e.g. { "control": "light.exposure", "value": 0.7 }. `
        : `the command's parameter object, e.g. { "cell": "A1", "input": "x" }. `)
      + `${profile.blurb} Files: ${profile.extensions.join(', ')}.`,
    parameters: {
      input: { type: 'string', description: `Absolute or workspace-relative path to an existing ${profile.extensions[0]} document. Mutually exclusive with \`sample\`.` },
      background: { type: 'boolean', description: 'Start the work as a background job and return immediately; poll it with the job tool. Use for long renders, bakes and bounces.' },
      commands: {
        type: 'array',
        description: 'Ordered commands to apply. Each is { "id": "cell.set", "json": { "cell": "A1", "input": "x" } }. An entry may also be a raw CLI string.',
        items: { type: 'json' },
      },
      ...(profile.run.saveMode ?? 'flag') !== 'none'
        ? { save: { type: 'string', description: `Path to write the edited document to (${profile.extensions.join('/')}).` } }
        : {},
      // `export` is always advertised when the craft can render one. Where the
      // craft writes documents and artifacts through the same flag (VectorCraft
      // `--export`), the executor folds `export` into `save`; the parameter is
      // still offered because naming the artifact is what a caller means, and
      // withholding it only pushes them to `extraArgs`.
      ...profile.run.exportFlag !== undefined
        ? { export: { type: 'string', description: 'Path to export a rendered artifact to (png/svg/pdf, or the app\'s native media type).' } }
        : {},
      ...profile.run.sampleFlag.length > 0
        ? {
            sample: profile.run.samples !== undefined
              ? { type: 'string', enum: [...profile.run.samples], description: 'Use a built-in sample document instead of `input`.' }
              : { type: 'boolean', description: 'Start from a new/empty document (the craft\'s own default template) instead of `input`.' },
          }
        : {},
      print: { type: 'boolean', description: 'Also print the resulting document state to stdout.' },
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Verbatim extra CLI arguments appended last, for flags this tool does not model.' },
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Verbatim extra CLI arguments appended last, for flags this tool does not model.' },
      ...profile.oneToolPerRun === true
        ? {
            resetSession: {
              type: 'boolean',
              description: `${profile.product} holds one document per process, so earlier commands are replayed to rebuild state. `
                + 'Set this to start a fresh document and drop that history.',
            },
          }
        : {},
    },
    async execute(args) {
      const binary = requireBinary()
      const input = typeof args.input === 'string' ? args.input : undefined
      // Sample semantics, in one place:
      //  - `sample: "<name>"` from the model is always honoured;
      //  - a craft whose document is its input (inputMode !== 'none') and whose
      //    sample flag takes no value defaults to that sample, so a call with
      //    no `input` starts from the built-in document rather than failing;
      //  - a craft with no sample flag (VectorCraft) starts blank, which is
      //    what its `run` does when given neither source;
      //  - a craft whose sample flag *requires* a value never defaults to it,
      //    because inventing that value would be a guess.
      const sample = resolveSample(profile, args)
      const requested = toCommandInputs(args.commands)
      const commands = withSession(requested, args.resetSession === true)
      // Crafts whose headless entry point only accepts a script file get one
      // written for this call; the file names the same commands the inline
      // style would have carried.
      // Crafts whose headless verb takes a generated script file instead of
      // inline command flags: FigCraft's `run script.json` and TextureCraft's
      // `batch script.json`. The kernel writes it, so the model still supplies
      // an ordered list and never has to know the file format.
      if (profile.run.scriptFile !== undefined) {
        const spec = profile.run.scriptFile
        const savePath = typeof args.save === 'string' ? args.save : undefined
        let effectiveInput = input
        if (effectiveInput === undefined && profile.run.sampleCreate !== undefined) {
          const created = join(craftWorkDir(profile), `sample-${Date.now()}${profile.run.sampleCreate.extension}`)
          mkdirSync(dirname(created), { recursive: true })
          const createdResult = await runCraft({
            profile, binary,
            argv: [profile.run.sampleCreate.verb, ...profile.run.sampleCreate.args, created],
            cwd: process.cwd(), timeoutMs,
          })
          if (!createdResult.ok) return renderRun(createdResult, profile)
          effectiveInput = created
        }
        const steps = commands.map(command => ({ [spec.commandKey]: command.id, [spec.paramsKey]: command.json ?? {} }))
        const scriptPath = join(craftWorkDir(profile), `run-${Date.now()}.${spec.encoding === 'jsonl' ? 'jsonl' : 'json'}`)
        mkdirSync(dirname(scriptPath), { recursive: true })
        const argv = [profile.run.verb]
        let body
        if (spec.batch !== undefined) {
          body = {
            ...effectiveInput !== undefined ? { [spec.batch.openKey]: effectiveInput } : {},
            [spec.batch.stepsKey]: steps,
            ...savePath !== undefined ? { [spec.batch.saveKey]: savePath } : {},
          }
          argv.push(scriptPath)
        } else {
          body = spec.encoding === 'jsonl' ? steps.map(step => JSON.stringify(step)).join('\n') + '\n' : steps
          argv.push(scriptPath)
          if (effectiveInput !== undefined && spec.inputFlag !== undefined) argv.push(spec.inputFlag, effectiveInput)
          if (savePath !== undefined && spec.saveFlag !== undefined) argv.push(spec.saveFlag, savePath)
        }
        writeFileSync(scriptPath, typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n')
        const extra = Array.isArray(args.extraArgs) ? args.extraArgs.filter((a): a is string => typeof a === 'string') : []
        return await runOrStart(binary, [...argv, ...extra], args.background, documentOf(args), labelOf(args))
      }
      if (profile.run.scriptFlag !== undefined) {
        const scriptPath = join(craftWorkDir(profile), `steps-${Date.now()}.json`)
        mkdirSync(dirname(scriptPath), { recursive: true })
        // PdfCraft's step file is `{tool, args}` per step; the shape is declared
        // by the craft, so the kernel keeps the JSON object form it accepts.
        writeFileSync(scriptPath, JSON.stringify(commands.map(command => ({
          tool: command.id,
          args: command.json ?? {},
        }))))
        const extra = [
          profile.run.scriptFlag, scriptPath,
          ...Array.isArray(args.extraArgs) ? args.extraArgs.filter((a): a is string => typeof a === 'string') : [],
        ]
        return await runOrStart(binary, [profile.run.verb, ...extra], args.background, documentOf(args), labelOf(args))
      }
      if (profile.run.scriptMode === true) {
        const scriptPath = join(craftWorkDir(profile), `run-${Date.now()}.jsonl`)
        mkdirSync(dirname(scriptPath), { recursive: true })
        writeFileSync(scriptPath, commands.map(command =>
          JSON.stringify({ id: command.id, params: command.json ?? {} })).join('\n') + '\n')
        const extra = [
          ...input !== undefined ? [input] : [],
          scriptPath,
          ...Array.isArray(args.extraArgs) ? args.extraArgs.filter((a): a is string => typeof a === 'string') : [],
        ]
        return await runOrStart(binary, [...globalFlagsFor(profile, args), profile.run.verb, ...extra], args.background, documentOf(args), labelOf(args))
      }
      // PdfCraft's `run` accepts exactly one tool per invocation; sending a
      // list would produce "expected key=value" from the CLI, so the extra
      // commands are reported instead of silently mis-executed.
      const [first, ...rest] = commands
      const single = profile.oneToolPerRun === true ? (first === undefined ? [] : [first]) : commands
      // PdfCraft accepts one tool per invocation, but a `--script` file runs a
      // whole list in a single process; the history recorded above is replayed
      // through that path, so a second call continues the same document.
      if (profile.oneToolPerRun === true && profile.run.scriptFlag === undefined && rest.length > 0) {
        const only = await runSingle(binary, input, sample, single, args.background)
        return `${only}\n\n[${profile.product} runs one tool per call: ${rest.length} further command(s) were not sent — ${rest.map(c => c.id).join(', ')}. Call this tool again for each.]`
      }
      const argv = buildRunArgv(profile, {
        ...input !== undefined ? { input } : {},
        ...sample !== undefined ? { sample } : {},
        commands: single,
        ...typeof args.save === 'string' ? { save: args.save } : {},
        // VectorCraft writes through one flag (`--export`); when a caller names
        // both, the artifact path is the one that must survive.
        ...typeof args.export === 'string' && profile.run.exportFlag !== profile.run.saveFlag
          ? { export: args.export }
          : typeof args.save !== 'string' && typeof args.export === 'string' && profile.run.exportFlag === profile.run.saveFlag
            ? { save: args.export }
            : {},
        ...args.print === true ? { print: true } : {},
        ...Array.isArray(args.extraArgs) ? { extra: args.extraArgs.filter((a): a is string => typeof a === 'string') } : {},
      })
      return await runOrStart(binary, argv, args.background, documentOf(args), labelOf(args))
    },
  }

  const commands: ToolSpec<'commands'> = {
    kind: 'commands',
    name: `${profile.id}_commands`,
    description:
      `List or search ${profile.product}'s commands and their parameter grammar. `
      + `Call this before \`${profile.id}_run\` whenever you are unsure of a command id or its JSON shape.`,
    parameters: {
      search: { type: 'string', description: 'Free-text filter over command ids, labels and parameters (case-insensitive). Omit to list the catalog from the start.' },
      limit: { type: 'number', description: `Maximum commands to print (default ${catalogLimit}).` },
      group: { type: 'string', description: 'Only commands in this family, e.g. "insert", "cell", "slide", "mix".' },
    },
    async execute(args) {
      const catalog = await runtime.catalog()
      let selected = catalog.commands
      if (typeof args.group === 'string' && args.group.length > 0) {
        selected = selected.filter(command => (command.group ?? '') === args.group)
      }
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
        ? Math.min(Math.floor(args.limit), 500)
        : catalogLimit
      const header = catalog.note !== undefined ? `${catalog.note}\n\n` : ''
      const binary = runtime.binary()
      const where = binary === undefined ? `(${profile.bin} not installed)` : `${binary.path}${binary.version !== undefined ? ` ${binary.version}` : ''}`
      return `${header}${renderCatalog(profile, selected, catalog.origin, limit, typeof args.search === 'string' ? args.search : undefined)}\n\nbinary: ${where}`
    },
  }

  const describe: ToolSpec<'describe'> = {
    kind: 'describe',
    name: `${profile.id}_describe`,
    description:
      `Look up one ${profile.product} command in full: its label, menu, and — most importantly — the exact JSON parameter `
      + `grammar it accepts. Use this when \`${profile.id}_commands\` showed a command you want but not enough detail to call it.`,
    parameters: {
      id: { type: 'string', required: true, description: 'Command id, e.g. "cell.set".' },
    },
    async execute(args) {
      const wanted = String(args.id ?? '').trim()
      if (wanted.length === 0) throw new Error('id is required')
      const catalog = await runtime.catalog()
      const command = catalog.commands.find(entry => entry.id === wanted)
        ?? catalog.commands.find(entry => entry.aliases?.includes(wanted) === true)
      if (command === undefined) {
        const near = catalog.commands
          .map(entry => ({ entry, weight: score(entry, wanted.toLowerCase()) }))
          .filter(candidate => candidate.weight > 0)
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 8)
        return [
          `No command with id ${JSON.stringify(wanted)} in the ${profile.product} catalog (${catalog.commands.length} commands, ${catalog.origin}).`,
          near.length > 0 ? `Did you mean: ${near.map(candidate => candidate.entry.id).join(', ')}` : `Search with \`${profile.id}_commands\`.`,
        ].join('\n')
      }
      // Some crafts' `commands` table carries no parameter column, but their own
      // `describe <id>` does; ask for it rather than reporting "(none)".
      let params = command.params
      let paramsSource = ''
      if ((params === undefined || params.length === 0) && profile.describeArgs !== undefined) {
        const binary = runtime.binary()
        if (binary !== undefined) {
          const detail = await runCraft({
            profile, binary,
            argv: [...profile.describeArgs, command.id],
            cwd: process.cwd(), timeoutMs: Math.min(timeoutMs, 20_000),
          })
          const fetched = extractParams(detail.stdout)
          if (fetched !== undefined) { params = fetched; paramsSource = ' (from the CLI\'s describe)' }
        }
      }
      const lines = [
        `${command.id}${command.label !== undefined ? `  — ${command.label}` : ''}`,
        params !== undefined && params.length > 0 ? `params: ${params}${paramsSource}` : 'params: (none declared)',
      ]
      if (command.menu !== undefined && command.menu.length > 0) lines.push(`menu: ${command.menu.join(' ▸ ')}`)
      if (command.shortcut !== undefined && command.shortcut !== null) lines.push(`shortcut: ${command.shortcut}`)
      if (command.aliases !== undefined && command.aliases.length > 0) lines.push(`aliases: ${command.aliases.join(', ')}`)
      if (command.description !== undefined) lines.push(command.description)
      lines.push('', `Call it with \`${profile.id}_run\`: commands: [{ "id": ${JSON.stringify(command.id)}, "json": { … } }]`)
      return lines.join('\n')
    },
  }

  const inspectSpec = readSpec(profile, 'inspect')
  const inspect: ToolSpec<'inspect'> | undefined = inspectSpec === undefined ? undefined : {
    kind: 'inspect',
    name: `${profile.id}_inspect`,
    description: `${inspectSpec.summary} Runs \`${profile.bin} ${inspectSpec.verb} <file>\` and returns its output. Read-only.`,
    parameters: {
      ...(inspectSpec.arg ?? 'file') === 'file'
        ? { file: { type: 'string', required: true, description: 'Path to the document to read.' } }
        : {},
      ...(inspectSpec.arg ?? 'file') === 'section'
        ? {
            section: { type: 'string', enum: ['project', 'sequence'], description: 'Which view to read (default project).' },
            project: { type: 'string', description: 'Project file to read, when the CLI needs one named explicitly.' },
          }
        : {},
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Verbatim extra CLI arguments appended last.' },
    },
    async execute(args) {
      const binary = requireBinary()
      const argMode = inspectSpec.arg ?? 'file'
      const file = String(args.file ?? '')
      if (argMode === 'file' && file.length === 0) throw new Error('file is required')
      const extra = Array.isArray(args.extraArgs) ? args.extraArgs.filter((a): a is string => typeof a === 'string') : []
      const argv = [inspectSpec.verb]
      if (argMode === 'file') argv.push(file)
      else if (argMode === 'section') argv.push(typeof args.section === 'string' && args.section.length > 0 ? args.section : inspectSpec.section ?? 'project')
      if (inspectSpec.projectFlag !== undefined && typeof args.project === 'string') argv.push(inspectSpec.projectFlag, args.project)
      argv.push(...inspectSpec.extraArgs ?? [], ...extra)
      return await runOrStart(binary, argv, args.background, documentOf(args), labelOf(args))
    },
  }

  const convert: ToolSpec<'convert'> | undefined = profile.reads?.some(read => read.name === 'convert') === true ? {
    kind: 'convert',
    name: `${profile.id}_convert`,
    description: `Convert a document between formats with \`${profile.bin} convert in out\`. The output format follows the output extension.`,
    parameters: {
      input: { type: 'string', required: true, description: 'Source document path.' },
      output: { type: 'string', required: true, description: 'Destination path; its extension selects the target format.' },
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Verbatim extra CLI arguments appended last.' },
    },
    async execute(args) {
      const binary = requireBinary()
      const extra = Array.isArray(args.extraArgs) ? args.extraArgs.filter((a): a is string => typeof a === 'string') : []
      const result = await runCraft({
        profile, binary,
        argv: ['convert', String(args.input ?? ''), String(args.output ?? ''), ...extra],
        cwd: process.cwd(), timeoutMs,
      })
      return renderRun(result, profile)
    },
  } : undefined

  const job: ToolSpec<'job'> = {
    kind: 'job',
    name: `${profile.id}_job`,
    description:
      `Track background work started by \`${profile.id}_run\` with \`background: true\`. `
      + `Long renders, bakes and bounces outlive a tool timeout; the job keeps running and logs to a file. `
      + `Actions: \`list\` every job, \`status\` one (with the log tail), \`wait\` for it to finish, \`kill\` it.`,
    parameters: {
      action: { type: 'string', enum: ['list', 'status', 'wait', 'kill'], description: 'What to do. Defaults to list.' },
      job: { type: 'string', description: 'Job id returned by the run call, e.g. "j1".' },
      timeoutMs: { type: 'number', description: 'For action "wait": milliseconds to block (default 60000, at most 600000).' },
      tailLines: { type: 'number', description: 'For "status"/"wait": how many log lines to show (default 20).' },
    },
    async execute(args) {
      const action = typeof args.action === 'string' ? args.action : 'list'
      const tailLines = typeof args.tailLines === 'number' && args.tailLines > 0 ? Math.min(Math.floor(args.tailLines), 200) : 20
      /** Last lines of a job's log, with a byte cap so a huge log cannot flood the model. */
      const tail = (path: string): string => {
        try {
          const text = readFileSync(path, 'utf8')
          const lines = text.split('\n')
          const shown = lines.slice(Math.max(0, lines.length - tailLines)).join('\n').trim()
          return shown.length > 8000 ? `…${shown.slice(-8000)}` : shown
        } catch {
          return '(no log yet)'
        }
      }
      /** A job's argv, shortened: a 200-command render would otherwise print pages. */
      const commandLine = (argv: readonly string[]): string => {
        const text = argv.join(' ')
        return text.length > 240 ? `${text.slice(0, 240)}… (${argv.length} arguments)` : text
      }
      const describe = (state: CraftJobState): string => [
        `${state.id}${state.running ? ' (running)' : ` (exit ${state.exitCode ?? state.signal ?? '?'})`}`
        + ` — ${state.durationMs === undefined ? `${Math.round((Date.now() - state.startedAt) / 1000)}s so far` : `${Math.round(state.durationMs / 1000)}s`}`,
        `  command: ${commandLine(state.argv)}`,
        `  log: ${state.logPath}`,
      ].join('\n')

      if (action === 'list') {
        const all = runtime.jobs()
        if (all.length === 0) return `${profile.product}: no background jobs in this session.`
        return [`${profile.product} background jobs: ${all.length}`, ...all.map(describe)].join('\n')
      }
      const id = typeof args.job === 'string' ? args.job.trim() : ''
      if (id.length === 0) throw new Error('job is required for action ' + JSON.stringify(action))
      if (action === 'kill') {
        const killed = runtime.killJob(id)
        const state = runtime.jobState(id)
        return killed ? `killed ${id}` : `${id} is not running${state === undefined ? ' (unknown job)' : ''}`
      }
      if (action === 'wait') {
        const timeout = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? Math.min(Math.floor(args.timeoutMs), 600_000) : 60_000
        const state = await runtime.waitForJob(id, timeout)
        if (state === undefined) return `No job named ${JSON.stringify(id)}.`
        return [describe(state), '', tail(state.logPath)].join('\n')
      }
      const state = runtime.jobState(id)
      if (state === undefined) return `No job named ${JSON.stringify(id)}.`
      return [describe(state), '', tail(state.logPath)].join('\n')
    },
  }

  const mcp = runtime.mcp()
  const idleMs = config.mcpIdleMs ?? 300_000

  const mcpTools: ToolSpec<'mcpTools'> | undefined = mcp === undefined ? undefined : {
    kind: 'mcpTools',
    name: `${profile.id}_mcp_tools`,
    description:
      `${profile.product}'s own MCP server tools, each with a real JSON Schema. `
      + `These are the modelled operations (think \`write_range\`, \`render\`), whereas \`${profile.id}_run\` takes generic `
      + `command strings. Use this to discover them, then call one with \`${profile.id}_mcp_call\`. `
      + `Search by name or description, page with \`offset\`/\`limit\` (large servers declare hundreds). `
      + `Also lists the server's MCP resources and prompts when it has them.`,
    parameters: {
      search: { type: 'string', description: 'Case-insensitive filter over tool names and descriptions.' },
      limit: { type: 'number', description: 'Maximum tools to describe (default 30, at most 200).' },
      offset: { type: 'number', description: 'Skip this many matches, to page through a long list.' },
      ...profile.mcpAttach !== undefined
        ? { attach: { type: 'number', description: `Control-channel port of a running ${profile.product} app, to drive the user's open document instead of a headless one.` } }
        : {},
    },
    async execute(args) {
      const attach = typeof args.attach === 'number' ? Math.floor(args.attach) : undefined
      const client = runtime.mcp(attach)
      if (client === undefined) throw new Error(`${profile.product} has no MCP server configured`)
      await client.start(idleMs)
      const all = await client.listTools()
      const needle = typeof args.search === 'string' ? args.search.trim().toLowerCase() : ''
      const matched = needle.length === 0
        ? all
        : all.filter(tool => tool.name.toLowerCase().includes(needle) || (tool.description ?? '').toLowerCase().includes(needle))
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 200) : 30
      const offset = typeof args.offset === 'number' && args.offset > 0 ? Math.floor(args.offset) : 0
      const shown = matched.slice(offset, offset + limit)
      const lines = [
        `${profile.product} MCP server — ${matched.length} tool(s)${needle.length > 0 ? ` matching ${JSON.stringify(args.search)}` : ''}`
        + (matched.length > offset + shown.length ? `, showing ${offset}–${offset + shown.length}` : ''),
        `server: ${client.describe()}`,
        '',
      ]
      for (const tool of shown) {
        lines.push(`${tool.name}${tool.description !== undefined ? ` — ${tool.description}` : ''}`)
        lines.push(renderSchema(tool.inputSchema))
      }
      if (shown.length === 0) lines.push('(no matching tools)')
      // Resources and prompts are the parts a tool-only bridge would miss: the
      // document, the command catalogue, and curated multi-step workflows.
      const [resources, prompts] = await Promise.all([client.listResources(), client.listPrompts()])
      if (resources.length > 0) {
        lines.push('', 'resources:')
        for (const resource of resources) lines.push(`  ${resource.uri}${resource.name !== undefined ? ` — ${resource.name}` : ''}`)
      }
      if (prompts.length > 0) {
        lines.push('', 'prompts:')
        for (const prompt of prompts) lines.push(`  ${prompt.name}${prompt.description !== undefined ? ` — ${prompt.description}` : ''}`)
      }
      return lines.join('\n')
    },
  }

  const mcpCall: ToolSpec<'mcpCall'> | undefined = mcp === undefined ? undefined : {
    kind: 'mcpCall',
    name: `${profile.id}_mcp_call`,
    description:
      `Call one tool on ${profile.product}'s MCP server with JSON arguments. `
      + `Discover names and schemas with \`${profile.id}_mcp_tools\` first. `
      + `Use this for modelled operations; use \`${profile.id}_run\` for arbitrary command ids. `
      + `Images a tool returns (render, screenshot) are saved to disk and named by path — look at them with \`read_image\`.`,
    parameters: {
      tool: { type: 'string', required: true, description: 'MCP tool name, exactly as listed.' },
      arguments: { type: 'object', additionalProperties: true, description: "The tool's arguments object; see its schema in the listing." },
      ...profile.mcpAttach !== undefined
        ? { attach: { type: 'number', description: `Control-channel port of a running ${profile.product} app, to drive the user's open document instead of a headless one.` } }
        : {},
    },
    async execute(args) {
      const attach = typeof args.attach === 'number' ? Math.floor(args.attach) : undefined
      const client = runtime.mcp(attach)
      if (client === undefined) throw new Error(`${profile.product} has no MCP server configured`)
      const name = String(args.tool ?? '').trim()
      if (name.length === 0) throw new Error('tool is required')
      await client.start(idleMs)
      if (client.cachedTools === undefined) await client.listTools()
      const declared = client.cachedTools?.find(tool => tool.name === name)
      if (declared === undefined) {
        const names = (client.cachedTools ?? []).map(tool => tool.name).slice(0, 20)
        return `No MCP tool named ${JSON.stringify(name)} on ${profile.product}. Known: ${names.join(', ')}`
      }
      const raw = args.arguments
      const params = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
      return await client.callTool(name, params, runtime.artifactsDir())
    },
  }

  const mcpStatus: ToolSpec<'mcpStatus'> | undefined = mcp === undefined ? undefined : {
    kind: 'mcpStatus',
    name: `${profile.id}_mcp_status`,
    description: `Report whether ${profile.product}'s MCP bridge is running and how it was started. Diagnostics only.`,
    parameters: {},
    async execute() {
      const client = runtime.mcp()
      if (client === undefined) return `${profile.product}: no MCP server configured.`
      return [
        `${profile.product} MCP bridge`,
        `command: ${client.describe()}`,
        `running: ${client.running}`,
        `tools cached: ${client.cachedTools === undefined ? 'no' : client.cachedTools.length}`,
        profile.mcpAttach === undefined
          ? 'attach: not supported (headless MCP server only)'
          : `attach: pass \`attach: <port>\` to drive a running app (it must be started with its control channel, e.g. \`${profile.bin.replace(/-cli$/, '')} --control <port>\`)`,
      ].join('\n')
    },
  }

  return {
    run, commands, describe,
    ...inspect !== undefined ? { inspect } : {},
    ...convert !== undefined ? { convert } : {},
    ...mcpTools !== undefined ? { mcpTools } : {},
    ...mcpCall !== undefined ? { mcpCall } : {},
    ...mcpStatus !== undefined ? { mcpStatus } : {},
    job,
  }
}



/** Prompt-section slot: after the built-in tool sections, app prose follows. */
export const CRAFT_SECTION_ORDER = 120

/**
 * The `defineTool` shape the kernel calls. Structurally typed so the kernel
 * itself needs no DSH import — the plugin passes the real implementation in.
 */
export type DefineTool = (options: {
  name: string
  description: string
  parameters: unknown
  output: {
    schema: unknown
    render: (args: unknown, value: { text: string; images?: unknown[] }) => unknown[]
  }
  execute: (args: never, exec: unknown) => Promise<string>
  presentCall?: (args: unknown) => unknown
  presentResult?: (args: unknown, result: { content?: readonly { type: string; text?: string }[]; isError: boolean }) => unknown
}) => unknown

/** One-line journal summary for a finished call. */
function journalSummary(kind: string, args: Record<string, unknown>, text: string, elapsedMs: number): string {
  const output = ['save', 'export', 'output', 'out'].map(key => args[key]).find(value => typeof value === 'string' && value.length > 0)
  switch (kind) {
    case 'run': {
      const count = Array.isArray(args.commands) ? args.commands.length : 0
      const exit = /exited (\d+)/.exec(text)
      return `${count} command(s)${output === undefined ? '' : ` → ${String(output)}`}`
        + `${exit === null ? '' : ` · exit ${exit[1]}`} · ${elapsedMs}ms`
    }
    case 'mcpCall':
      return `tool ${String(args.tool ?? '?')} · ${elapsedMs}ms`
    case 'job':
      return `job ${String(args.action ?? 'list')}${typeof args.job === 'string' ? ` ${args.job}` : ''}`
    case 'inspect':
    case 'convert':
      return `${String(args.file ?? args.input ?? '')}${args.output === undefined ? '' : ` → ${String(args.output)}`}`
    default: {
      const first = text.trim().split('\n')[0] ?? ''
      return first.length > 120 ? `${first.slice(0, 120)}…` : first
    }
  }
}

/** The `ctx` surface the kernel uses; kept structural for the same reason. */
export interface CraftPluginContext {
  readonly tools: { register: (tool: unknown) => () => void }
  readonly systemPrompt: {
    section: (section: { name: string; text: string; order: number }) => unknown
  }
  readonly effect: (callback: () => () => void) => unknown
}

/**
 * Register every craft tool on `ctx.tools` and return a disposer.
 *
 * Plugin packages call this instead of hand-rolling a registration per tool, so
 * one place owns the contract: the harness's own `defineTool` is supplied by the
 * caller, the kernel attaches nothing global, releases the MCP server when the
 * plugin unloads, and adds the system-prompt section that tells the model the
 * tools exist.
 * @param ctx - the plugin's Cordis context.
 * @param options - the craft, the plugin package root, the config, and `defineTool`.
 * @returns a disposer that unregisters the tools and closes the MCP server.
 */
export function applyCraftPlugin(
  ctx: CraftPluginContext,
  options: {
    readonly profile: CraftProfile
    /** Absolute plugin package root, used to locate `catalog/<id>.json`. */
    readonly packageRoot: string
    readonly config?: CraftPluginConfig
    /** The harness's `defineTool`, passed in to keep this module dependency-free. */
    readonly defineTool: DefineTool
    /**
     * Commit a rendered preview as a durable image block. Supplied by the plugin
     * (which has the attachment service) so the kernel stays harness-free; when
     * absent the preview path stays in the text and the panel still shows it.
     */
    readonly attachImage?: (path: string) => Promise<unknown | undefined>
  },
): () => void {
  const { profile, packageRoot, config = {}, defineTool } = options
  const runtime = createRuntime(profile, packageRoot, config)
  const tools = createToolSet(runtime)
  const disposers: (() => void)[] = []
  for (const spec of Object.values(tools)) {
    if (spec === undefined) continue
    disposers.push(ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string' },
            images: { type: 'array', items: { type: 'json' } },
          },
        },
        render: (_args: unknown, value: { text: string; images?: unknown[] }) => {
          const blocks: unknown[] = []
          if (value.text.length > 0) blocks.push({ type: 'text' as const, text: value.text })
          for (const image of value.images ?? []) if (image !== undefined) blocks.push(image)
          return blocks.length > 0 ? blocks : [{ type: 'text' as const, text: '' }]
        },
      },
      async execute(args: never) {
        const typed = args as unknown as Record<string, unknown>
        const startedAt = Date.now()
        try {
          const text = await spec.execute(typed)
          appendJournal(profile, { at: startedAt, kind: spec.kind, summary: journalSummary(spec.kind, typed, text, Date.now() - startedAt) })
          // A preview line becomes a real image block when the plugin can commit
          // one: that is what makes the transcript show each step of the work.
          const previewPaths = [...text.matchAll(/^\[preview\] (.+)$/gm)].map(match => match[1].trim())
          if (previewPaths.length > 0 && options.attachImage !== undefined) {
            const images: unknown[] = []
            for (const path of previewPaths) {
              const block = await options.attachImage(path)
              if (block !== undefined) images.push(block)
            }
            return { text: text.replace(/^\[preview\] .+$/gm, '').trim(), images }
          }
          return { text, images: [] }
        } catch (error) {
          appendJournal(profile, {
            at: startedAt,
            kind: spec.kind,
            summary: `failed: ${String((error as Error).message ?? error).slice(0, 140)}`,
          })
          throw error
        }
      },
      // Cards: a run is one call with a dozen steps, so the raw JSONL is a poor
      // row. These turn it into a titled card — what the call does, then what it
      // produced — and the journal keeps the same story on disk.
      presentCall: (args: unknown) => craftCallView(profile, spec.kind, (args ?? {}) as Record<string, unknown>),
      presentResult: (args: unknown, result: { content?: readonly { type: string; text?: string }[]; isError: boolean }) =>
        craftResultView(
          profile,
          spec.kind,
          (result.content ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n'),
          result.isError === true,
        ),
    })))
  }
  ctx.systemPrompt.section({
    name: `artcraft:${profile.id}`,
    text:
      `${profile.product} is available through the ${profile.id}_* tools; documents are ${profile.extensions.join('/')}. `
      + `Two surfaces reach the same engine. Use \`${profile.id}_commands\` for the full command registry `
      + `(every menu action; fetch exact parameter grammar with \`${profile.id}_describe\`) and \`${profile.id}_run\` to apply `
      + `an ordered list. Use \`${profile.id}_mcp_tools\` for the app's modelled operations with JSON Schemas when you want `
      + `a safer first call, then \`${profile.id}_mcp_call\`. `
      + `Read a document back with \`${profile.id}_inspect\` before editing it. `
      + (profile.mcpAttach === undefined
        ? ''
        : `When the user has ${profile.product} open, pass \`attach: <control port>\` to an mcp call to work in their window instead of a headless copy. `)
      + `Images returned by a render or screenshot are saved and named by path; look at them with \`read_image\`.`
      + (() => {
        const partners = [...new Set(workflowsOf(profile.id).flatMap(workflow => workflow.crafts).filter(craft => craft !== profile.id))]
        if (partners.length === 0) return ''
        // A half-installed workflow is the common gap: name the partners so the
        // agent can offer the missing plugin instead of failing at the join.
        return ` Workflows that start in ${profile.product} usually also need ${partners.join(', ')}: if one of those tools is unavailable, say which plugin provides it and offer to install it.`
      })(),
    order: CRAFT_SECTION_ORDER,
  })
  return () => {
    for (const dispose of disposers) dispose()
    runtime.dispose()
  }
}
