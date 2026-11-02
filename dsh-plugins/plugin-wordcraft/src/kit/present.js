/**
 * Render intents for the craft tools: what a call looks like *while running* and
 * what its result looks like afterwards.
 *
 * A craft run is one call that performs a dozen steps, and a raw JSONL dump is a
 * poor card: the reader cannot see how many steps there are, which one failed, or
 * what files came out. These presenters turn the same result into a titled card
 * (a UI that understands {@link ToolCallView}/{@link ToolResultView} shows it as a
 * tool row with a header and a short body).
 *
 * The kernel stays DSH-free: these are plain objects shaped like the harness's
 * view contracts, and the calling plugin passes them to `defineTool`.
 * @module @dsh-artcraft/craft-kit/present
 */

                                              

/** One text block, as the harness's content-block shape expects. */
                                
                       
                       
 

/** A file the call touches, for editor follow-along. */
                               
                       
                        
 

/** Pending-call card: `{card:'generic'}` with a title and an optional body. */
                           
                          
                        
                                                                                                
                             
                                             
                                              
 

/** Completed-call card: a replacement title and reformatted content. */
                             
                          
                         
                                            
 

/** Arguments the model passed, as far as these presenters care. */
                                   

/** First `count` entries of a list, plus a count when longer. */
function summarise   (items              , render                     , count = 8)                  {
  const shown = items.slice(0, count).map(render)
  if (items.length > shown.length) shown.push(`…and ${items.length - shown.length} more`)
  return shown.length === 0 ? [{ type: 'text', text: '(no commands)' }] : shown.map(text => ({ type: 'text', text }))
}

/** The command list a run call carries, whether objects or raw strings. */
function commandLabels(raw         )           {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    if (typeof entry === 'string') return entry
    if (typeof entry === 'object' && entry !== null) {
      const record = entry                                    
      const id = typeof record.id === 'string' ? record.id : '(unnamed)'
      const json = record.json === undefined ? '' : ` ${JSON.stringify(record.json)}`
      return `${id}${json.length > 60 ? `${json.slice(0, 60)}…` : json}`
    }
    return String(entry)
  })
}

/** A path from the arguments, when the call writes one. */
function outputPath(args      )                     {
  for (const key of ['save', 'export', 'output', 'out']         ) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** A path from the arguments, when the call reads one. */
function inputPath(args      )                     {
  const value = args.input ?? args.file
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * The pending-call card for one tool.
 * @param profile - the craft, for the title.
 * @param kind - which tool of the set is being called.
 * @param args - the model's arguments.
 * @returns a generic call view.
 */
export function craftCallView(profile              , kind        , args      )           {
  const name = profile.product
  switch (kind) {
    case 'run': {
      const labels = commandLabels(args.commands)
      const target = outputPath(args)
      return {
        card: 'generic',
        kind: 'execute',
        title: `${name} · ${labels.length} command${labels.length === 1 ? '' : 's'}${target === undefined ? '' : ` → ${target}`}`,
        content: summarise(labels, label => `• ${label}`),
        ...target === undefined ? {} : { locations: [{ path: target }] },
      }
    }
    case 'commands': {
      const search = typeof args.search === 'string' && args.search.length > 0 ? ` "${args.search}"` : ''
      return { card: 'generic', kind: 'search', title: `${name} · command catalogue${search}` }
    }
    case 'describe': {
      const id = typeof args.id === 'string' ? args.id : ''
      return { card: 'generic', kind: 'read', title: `${name} · describe ${id}` }
    }
    case 'inspect': {
      const file = inputPath(args) ?? '(default)'
      return { card: 'generic', kind: 'read', title: `${name} · inspect ${file}`, locations: [{ path: file }] }
    }
    case 'convert': {
      const input = inputPath(args) ?? ''
      const output = typeof args.output === 'string' ? args.output : ''
      return {
        card: 'generic',
        kind: 'execute',
        title: `${name} · convert ${input}${output.length === 0 ? '' : ` → ${output}`}`,
        locations: output.length === 0 ? [] : [{ path: output }],
      }
    }
    case 'mcpCall': {
      const tool = typeof args.tool === 'string' ? args.tool : '(tool)'
      const attach = typeof args.attach === 'number' ? ` · attached :${args.attach}` : ''
      return { card: 'generic', kind: 'execute', title: `${name} · ${tool}${attach}`, rawInput: args.arguments }
    }
    case 'mcpTools': {
      const search = typeof args.search === 'string' && args.search.length > 0 ? ` "${args.search}"` : ''
      return { card: 'generic', kind: 'search', title: `${name} · MCP tools, resources and prompts${search}` }
    }
    case 'mcpStatus':
      return { card: 'generic', kind: 'read', title: `${name} · MCP bridge status` }
    case 'job': {
      const action = typeof args.action === 'string' ? args.action : 'list'
      const job = typeof args.job === 'string' ? ` ${args.job}` : ''
      return { card: 'generic', kind: 'other', title: `${name} · job ${action}${job}` }
    }
    default:
      return { card: 'generic', kind: 'other', title: `${name} · ${kind}` }
  }
}

/** What a run result text says: exit status, duration, artifacts, per-step failures. */
function summariseRun(profile              , text        )             {
  const steps = text.split('\n').filter(line => line.startsWith('{"command"') || line.startsWith('{"step"'))
  let ok = 0
  let failed = 0
  let firstFailure = ''
  for (const line of steps) {
    try {
      const parsed = JSON.parse(line)                                                      
      if (parsed.ok === false) {
        failed += 1
        if (firstFailure.length === 0) firstFailure = `${parsed.command ?? 'step'}: ${parsed.error ?? 'failed'}`
      } else ok += 1
    } catch {
      // A craft that prints non-JSON progress lines still runs; the exit line below decides.
    }
  }
  const exit = /exited (\d+) in (\d+)ms/.exec(text)
  const artifacts = [...text.matchAll(/^(?:wrote|saved|exported) (.+)$/gm)].map(match => match[1])
  const title = `${profile.product} · ${steps.length > 0 ? `${ok} ok${failed > 0 ? `, ${failed} failed` : ''}` : 'finished'}${exit === null ? '' : ` · exit ${exit[1]}`}`
  const body           = []
  if (failed > 0) body.push(`first failure — ${firstFailure}`)
  if (artifacts.length > 0) body.push(`wrote ${artifacts.join(', ')}`)
  if (exit !== null) body.push(`took ${exit[2]} ms`)
  if (body.length === 0) body.push(text.trim().split('\n')[0] ?? '(no output)')
  return { card: 'generic', title, content: body.map(line => ({ type: 'text', text: line })) }
}

/**
 * The completed-call card for one tool.
 * @param profile - the craft, for the title.
 * @param kind - which tool ran.
 * @param text - the model-facing result.
 * @param isError - whether the call failed.
 * @returns a generic result view.
 */
export function craftResultView(profile              , kind        , text        , isError         )             {
  if (isError) {
    return {
      card: 'generic',
      title: `${profile.product} · ${kind} failed`,
      content: [{ type: 'text', text: text.split('\n').slice(0, 4).join('\n') }],
    }
  }
  if (kind === 'run') return summariseRun(profile, text)
  const firstLine = text.trim().split('\n')[0] ?? ''
  const lines = text.split('\n').length
  return {
    card: 'generic',
    title: `${profile.product} · ${kind}`,
    content: [{ type: 'text', text: lines > 1 ? `${firstLine}\n(${lines} lines)` : firstLine }],
  }
}
