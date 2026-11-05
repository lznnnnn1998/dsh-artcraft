/**
 * Render a document's current state for the live preview.
 *
 * Three things share this module: the image block a tool returns after an edit,
 * the local panel in `scripts/preview/`, and the DSH client panel: they all read
 * the same state directory (`docs/PREVIEW.md` holds the contract).
 *
 * Rendering goes through the craft's own binary — never a screenshot of a window
 * — so the preview shows what the application itself would show.
 * @module @dsh-artcraft/craft-kit/preview
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { runCraft } from './exec.js'
import { CraftMcpClient } from './mcp.js'
import { discoverCraft } from './discover.js'
import { PROFILES_BY_ID } from './profiles.mjs'
                                                           

/** Where the previews live when no configuration overrides it. */
export function previewRoot(configured         )         {
  if (configured !== undefined && configured.length > 0) return configured
  const fromEnv = process.env.DSH_ARTCRAFT_PREVIEW_DIR
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'artcraft', 'preview')
}

/**
 * How one craft renders a document to an image.
 *
 * A craft with no recipe still reports a step in the panel; it just has no
 * picture (SoundCraft has no page, and the MCP-only crafts need their server).
 */
                         
                                                                                     
                                                                                               
 

/** Per-craft render recipes, verified against the 2026-11 CLI releases. */
const RECIPES                                = {
  // `render FILE OUT [--page N] [--scale S]` draws a page as a PNG.
  wordcraft: { argv: (file, out, scale, index) => ['render', file, out, '--page', String(index + 1), '--scale', String(scale)] },
  // `convert` picks the format from the output extension.
  cadcraft: { argv: (file, out) => ['convert', file, out] },
  figcraft: { argv: (file, out) => ['convert', file, out] },
  // `render FILE [--slide N] [--scale S] OUT` draws one slide as a PNG.
  deckcraft: { argv: (file, out, scale, index) => ['render', file, '--slide', String(index), '--scale', String(scale), out] },
  // VectorCraft exports the active artboard through `run --export`.
  vectorcraft: { argv: (file, out) => ['run', file, '--export', out] },
  // TextureCraft renders the viewport (2D view; the 3D one needs a GPU).
  texturecraft: { argv: (file, out) => ['render', file, out, '--view', '2d'] },
  // PhotoCraft converts the document; `convert` picks the format by extension.
  photocraft: { argv: (file, out) => ['convert', file, out] },
  // EffectCraft renders one frame at t=0 without the render queue.
  effectcraft: { argv: (file, out) => ['render-frame', '--time', '0', '--out', out] },
  // LightCraft develops one file through the same encoder as the export dialog.
  lightcraft: { argv: (file, out) => ['render', file, '-o', out] },
}

/**
 * Crafts whose page only exists through their MCP server.
 *
 * PdfCraft has no CLI render verb and FilmCraft renders a sequence frame, not a
 * file; both answer over MCP, so the preview borrows their own server.
 */
const MCP_RENDER                                           = { pdfcraft: 'pdfcraft', filmcraft: 'filmcraft' }

/**
 * Crafts that can export a PDF but cannot rasterise one. Their preview exports
 * a temporary PDF with the craft's own CLI and renders it through PdfCraft —
 * the alternative is no preview at all for the three most document-shaped apps.
 */
const PDF_BRIDGE                                                                   = {
  gridcraft: (file, pdf) => ['convert', file, pdf],
  designcraft: (file, pdf) => ['run', '--in', file, '--export', pdf],
}

/** Open one craft's MCP server, run a callback, always close it. */
async function withMcp   (craftId        , run                                        )                         {
  // `PROFILES_BY_ID` is a Map, not a record.
  const profile = (PROFILES_BY_ID                             ).get(craftId)
  if (profile === undefined) return undefined
  const binary = discoverCraft(profile)
  if (binary === undefined) return undefined
  const client = new CraftMcpClient(profile, binary)
  try {
    await client.start(60_000)
    return await run(client)
  } catch {
    return undefined
  } finally {
    client.close()
  }
}

/** Call an MCP tool that answers with an image, and copy it to the step file. */
async function imageFromCall(
  client                ,
  tool        ,
  args                         ,
  out        ,
)                                                      {
  const text = await client.callTool(tool, args, join(dirname(out), '.mcp-images'))
  const match = /\[image\]\s+(.+)/.exec(text)
  if (match === null) return undefined
  try {
    copyFileSync(match[1].trim(), out)
  } catch {
    return undefined
  }
  const hash = imageHash(out)
  return hash === undefined ? undefined : { path: out, hash }
}

/** Whether a craft can render a preview at all. */
export function canPreview(profile              )          {
  return RECIPES[profile.id] !== undefined
    || MCP_RENDER[profile.id] !== undefined
    || PDF_BRIDGE[profile.id] !== undefined
}

/** One preview step, as documented in docs/PREVIEW.md. */
                              
                    
                     
                       
                        
                          
                         
                         
                         
                          
                                                                                      
                        
                                                 
                        
                              
                                                                                   
 

/**
 * One clip on a time-based craft's timeline, in seconds.
 *
 * `timeline` is a property of the DOCUMENT (the whole sequence), not of a step:
 * the panel draws one bar under the current render, and a per-step bar would
 * make it jump between steps that did not change the sequence.
 */
                              
                        
                           
                        
 

/** A craft's `state.json`. */
                               
                        
                          
                       
                        
                            
                          
                                                                            
                                            
                                        
 

/**
 * How many pages or slides a document has, for the crafts that can report it.
 * @param profile - the craft.
 * @param binary - its binary.
 * @param file - the document.
 * @returns the count, or 1 when unknown (rendering the first page is always safe).
 */
export async function pageCount(profile              , binary             , file        , timeoutMs = 30_000)                  {
  if (profile.id !== 'wordcraft' && profile.id !== 'deckcraft') return 1
  try {
    const result = await runCraft({ profile, binary, argv: ['info', file], cwd: process.cwd(), timeoutMs })
    if (!result.ok) return 1
    const parsed = JSON.parse(result.stdout)                                       
    const count = profile.id === 'wordcraft' ? parsed.pages : parsed.slides
    return typeof count === 'number' && count > 0 ? count : 1
  } catch {
    return 1
  }
}

/** Content hash of a rendered image, so an unchanged page is not a new step. */
export function imageHash(path        )                     {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

/**
 * Render one document to `<dir>/<craft>/step-NNN.png`.
 *
 * Never throws: a preview is a convenience, and a craft that cannot render must
 * not fail the edit that produced it.
 * @param profile - the craft that wrote the document.
 * @param binary - its resolved binary.
 * @param options - document path, output directory and render scale.
 * @returns the absolute image path, or `undefined` when the craft cannot render.
 */
export async function renderPreview(
  profile              ,
  binary             ,
  options                                                                                                                                                     ,
)                                                      {
  if (!existsSync(options.file)) return undefined
  mkdirSync(options.dir, { recursive: true })

  // PdfCraft and FilmCraft render through their own MCP server: PdfCraft has no
  // CLI render verb, and a FilmCraft frame is a timeline position, not a file.
  if (MCP_RENDER[profile.id] !== undefined) {
    if (profile.id === 'pdfcraft') return await renderPdf(options.file, options)
    return await withMcp('filmcraft', async (client) => {
      await client.callTool('command_run', { id: 'file.open', params: { path: options.file } })
      return await imageFromCall(client, 'render_frame', { max_side: 1400 }, options.out)
    })
  }

  // GridCraft and DesignCraft export a PDF but cannot rasterise one; PdfCraft
  // renders the page, so the preview has a picture instead of a step with none.
  const bridge = PDF_BRIDGE[profile.id]
  if (bridge !== undefined) {
    const pdf = join(options.dir, `${profile.id}-preview.pdf`)
    try {
      const exported = await runCraft({
        profile, binary,
        argv: bridge(options.file, pdf),
        cwd: process.cwd(),
        timeoutMs: options.timeoutMs ?? 120_000,
      })
      if (!exported.ok || !existsSync(pdf)) return undefined
    } catch {
      return undefined
    }
    return await renderPdf(pdf, options)
  }

  const recipe = RECIPES[profile.id]
  if (recipe === undefined) return undefined
  try {
    const argv = recipe.argv(options.file, options.out, options.scale ?? 1.5, options.page ?? 0)
    const result = await runCraft({ profile, binary, argv, cwd: process.cwd(), timeoutMs: options.timeoutMs ?? 60_000 })
    if (!result.ok || !existsSync(options.out)) return undefined
    const hash = imageHash(options.out)
    return hash === undefined ? undefined : { path: options.out, hash }
  } catch {
    return undefined
  }
}

/** Render one page of a PDF through PdfCraft's MCP server. */
async function renderPdf(
  file        ,
  options                                                  ,
)                                                      {
  return await withMcp('pdfcraft', async (client) => {
    const opened = await client.callTool('doc_open', { path: file })
    // PdfCraft answers `{doc: 1, pages: 2, …}`; `id` is only a fallback for a
    // server that renames the field.
    let docId
    try {
      const parsed = JSON.parse(opened)                                 
      docId = parsed.doc ?? parsed.id
    } catch {
      const match = /"(?:doc|id)"\s*:\s*(\d+)/.exec(opened)
      docId = match === null ? undefined : Number(match[1])
    }
    if (typeof docId !== 'number') return undefined
    return await imageFromCall(client, 'page_render', { doc: docId, page: (options.page ?? 0) + 1, dpi: 110 }, options.out)
  })
}

/**
 * The next step number for a craft, across processes.
 *
 * A plugin process starts its own counter at zero, so numbering from memory
 * alone makes a restarted session overwrite the earlier steps it wrote to disk.
 * The state file is the truth: continue after the highest number recorded.
 * @param root - preview root.
 * @param craft - craft id.
 * @returns the next 1-based step number.
 */
export function nextStepNumber(root        , craft        )         {
  try {
    const state = JSON.parse(readFileSync(join(root, craft, 'state.json'), 'utf8'))                
    return state.steps.reduce((highest, step) => Math.max(highest, step.n), 0) + 1
  } catch {
    return 1
  }
}

/**
 * Remove a render that matched the previous step's image.
 * @param path - the rendered file.
 * @returns nothing; a missing file is not an error.
 */
export function discardRender(path        )       {
  try {
    unlinkSync(path)
  } catch {
    // Already gone.
  }
}

/**
 * The hash of the last rendered step, for skipping a render that repeats it.
 * @param root - preview root.
 * @param craft - craft id.
 * @returns the hash, or `undefined` when there is no earlier render.
 */
export function lastStepHash(root        , craft        )                     {
  try {
    const state = JSON.parse(readFileSync(join(root, craft, 'state.json'), 'utf8'))                
    const last = state.steps[state.steps.length - 1]
    if (last === undefined) return undefined
    if (last.hash !== undefined) return last.hash
    return last.image === undefined ? undefined : imageHash(join(root, craft, last.image))
  } catch {
    return undefined
  }
}

/** Read-modify-write one craft's state and refresh the index. */
export function recordPreview(
  root        ,
  profile              ,
  step             ,
  file        ,
  pages        ,
  timeline                         ,
)               {
  const craftDir = join(root, profile.id)
  mkdirSync(craftDir, { recursive: true })
  const statePath = join(craftDir, 'state.json')
  let previous                          
  try {
    previous = JSON.parse(readFileSync(statePath, 'utf8'))                
  } catch {
    previous = undefined
  }
  const resolved              = { ...step, n: previous === undefined ? step.n : Math.max(step.n, (previous.steps.reduce((highest, entry) => Math.max(highest, entry.n), 0)) + 1) }
  const steps = [...(previous?.steps ?? []).filter(entry => entry.n !== resolved.n), resolved]
  const state               = {
    craft: profile.id,
    product: profile.product,
    file,
    pages,
    updatedAt: new Date().toISOString(),
    current: resolved.n,
    // Keep the last known timeline: a step that only moved the playhead must
    // not erase the clips a previous step reported.
    ...timeline !== undefined ? { timeline } : previous?.timeline !== undefined ? { timeline: previous.timeline } : {},
    steps,
  }
  writeFileSync(statePath, JSON.stringify(state, undefined, 2) + '\n')

  // index.json is the panel's first read: one entry per craft, no history.
  const indexPath = join(root, 'index.json')
  let index                                                                                                                       =
    { updatedAt: state.updatedAt, crafts: {} }
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'))                
  } catch {
    // First write for this session.
  }
  index.crafts[profile.id] = { file, pages, stepCount: state.steps.length, updatedAt: state.updatedAt }
  index.updatedAt = state.updatedAt
  writeFileSync(indexPath, JSON.stringify(index, undefined, 2) + '\n')
  return state
}

/** A stable name for this step's render, e.g. `step-003.png`. */
export function stepName(n        )         {
  return `step-${String(n).padStart(3, '0')}.png`
}

/** The display name of a document path, for the panel's header. */
export function documentLabel(file        )         {
  return basename(dirname(file)) + '/' + basename(file)
}
