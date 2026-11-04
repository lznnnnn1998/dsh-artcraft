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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { runCraft } from './exec.ts'
import type { CraftBinary, CraftProfile } from './types.ts'

/** Where the previews live when no configuration overrides it. */
export function previewRoot(configured?: string): string {
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
interface PreviewRecipe {
  /** Compose the argv that writes `out` from `file`, for a 0-based page or slide. */
  readonly argv: (file: string, out: string, scale: number, index: number) => readonly string[]
}

/** Per-craft render recipes, verified against the 2026-11 CLI releases. */
const RECIPES: Record<string, PreviewRecipe> = {
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

/** Whether a craft can render a preview at all. */
export function canPreview(profile: CraftProfile): boolean {
  return RECIPES[profile.id] !== undefined
}

/** One preview step, as documented in docs/PREVIEW.md. */
export interface PreviewStep {
  readonly n: number
  readonly at: string
  readonly tool: string
  readonly title: string
  readonly summary: string
  readonly image?: string
  readonly thumb?: string
  readonly width?: number
  readonly height?: number
  /** Content hash of the render, used to skip a step that changed nothing visible. */
  readonly hash?: string
  /** 1-based page or slide this render shows. */
  readonly page?: number
  readonly durationMs?: number
  readonly timeline?: readonly { start: number; duration: number; label: string }[]
}

/**
 * One clip on a time-based craft's timeline, in seconds.
 *
 * `timeline` is a property of the DOCUMENT (the whole sequence), not of a step:
 * the panel draws one bar under the current render, and a per-step bar would
 * make it jump between steps that did not change the sequence.
 */
export interface PreviewClip {
  readonly start: number
  readonly duration: number
  readonly label: string
}

/** A craft's `state.json`. */
export interface PreviewState {
  readonly craft: string
  readonly product: string
  readonly file: string
  readonly pages: number
  readonly updatedAt: string
  readonly current: number
  /** Present for time-based crafts (FilmCraft, EffectCraft, SoundCraft). */
  readonly timeline?: readonly PreviewClip[]
  readonly steps: readonly PreviewStep[]
}

/**
 * How many pages or slides a document has, for the crafts that can report it.
 * @param profile - the craft.
 * @param binary - its binary.
 * @param file - the document.
 * @returns the count, or 1 when unknown (rendering the first page is always safe).
 */
export async function pageCount(profile: CraftProfile, binary: CraftBinary, file: string, timeoutMs = 30_000): Promise<number> {
  if (profile.id !== 'wordcraft' && profile.id !== 'deckcraft') return 1
  try {
    const result = await runCraft({ profile, binary, argv: ['info', file], cwd: process.cwd(), timeoutMs })
    if (!result.ok) return 1
    const parsed = JSON.parse(result.stdout) as { pages?: number; slides?: number }
    const count = profile.id === 'wordcraft' ? parsed.pages : parsed.slides
    return typeof count === 'number' && count > 0 ? count : 1
  } catch {
    return 1
  }
}

/** Content hash of a rendered image, so an unchanged page is not a new step. */
export function imageHash(path: string): string | undefined {
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
  profile: CraftProfile,
  binary: CraftBinary,
  options: { readonly file: string; readonly dir: string; readonly out: string; readonly scale?: number; readonly timeoutMs?: number; readonly page?: number },
): Promise<{ path: string; hash: string } | undefined> {
  const recipe = RECIPES[profile.id]
  if (recipe === undefined) return undefined
  if (!existsSync(options.file)) return undefined
  try {
    mkdirSync(options.dir, { recursive: true })
    const argv = recipe.argv(options.file, options.out, options.scale ?? 1.5, options.page ?? 0)
    const result = await runCraft({ profile, binary, argv, cwd: process.cwd(), timeoutMs: options.timeoutMs ?? 60_000 })
    if (!result.ok || !existsSync(options.out)) return undefined
    const hash = imageHash(options.out)
    return hash === undefined ? undefined : { path: options.out, hash }
  } catch {
    return undefined
  }
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
export function nextStepNumber(root: string, craft: string): number {
  try {
    const state = JSON.parse(readFileSync(join(root, craft, 'state.json'), 'utf8')) as PreviewState
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
export function discardRender(path: string): void {
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
export function lastStepHash(root: string, craft: string): string | undefined {
  try {
    const state = JSON.parse(readFileSync(join(root, craft, 'state.json'), 'utf8')) as PreviewState
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
  root: string,
  profile: CraftProfile,
  step: PreviewStep,
  file: string,
  pages: number,
  timeline?: readonly PreviewClip[],
): PreviewState {
  const craftDir = join(root, profile.id)
  mkdirSync(craftDir, { recursive: true })
  const statePath = join(craftDir, 'state.json')
  let previous: PreviewState | undefined
  try {
    previous = JSON.parse(readFileSync(statePath, 'utf8')) as PreviewState
  } catch {
    previous = undefined
  }
  const resolved: PreviewStep = { ...step, n: previous === undefined ? step.n : Math.max(step.n, (previous.steps.reduce((highest, entry) => Math.max(highest, entry.n), 0)) + 1) }
  const steps = [...(previous?.steps ?? []).filter(entry => entry.n !== resolved.n), resolved]
  const state: PreviewState = {
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
  let index: { updatedAt: string; crafts: Record<string, { file: string; pages: number; stepCount: number; updatedAt: string }> } =
    { updatedAt: state.updatedAt, crafts: {} }
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8')) as typeof index
  } catch {
    // First write for this session.
  }
  index.crafts[profile.id] = { file, pages, stepCount: state.steps.length, updatedAt: state.updatedAt }
  index.updatedAt = state.updatedAt
  writeFileSync(indexPath, JSON.stringify(index, undefined, 2) + '\n')
  return state
}

/** A stable name for this step's render, e.g. `step-003.png`. */
export function stepName(n: number): string {
  return `step-${String(n).padStart(3, '0')}.png`
}

/** The display name of a document path, for the panel's header. */
export function documentLabel(file: string): string {
  return basename(dirname(file)) + '/' + basename(file)
}
