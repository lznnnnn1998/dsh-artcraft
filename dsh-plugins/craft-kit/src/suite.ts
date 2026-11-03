/**
 * The ArtCraft suite graph: which applications work together.
 *
 * A user who installs one craft has a working tool, not the best version of the
 * workflow they are about to attempt: a report wants a spreadsheet and a word
 * processor, a video wants slides and a mixer. This is the one place that
 * knowledge lives, so the installer, the doctor and the plugins agree.
 * @module @dsh-artcraft/craft-kit/suite
 */

/** A workflow that spans several crafts. */
export interface SuiteWorkflow {
  readonly id: string
  readonly delivers: string
  readonly crafts: readonly string[]
}

/** A package that is not a craft but completes the experience. */
export interface SuiteCompanion {
  readonly id: string
  readonly package: string
  readonly why: string
}

/** Workflows that need more than one craft. */
export const SUITE_WORKFLOWS: readonly SuiteWorkflow[] = [
  { id: 'report', delivers: 'a data-backed report as DOCX and PDF', crafts: ['gridcraft', 'wordcraft', 'pdfcraft'] },
  { id: 'deck', delivers: 'a presentation with native charts', crafts: ['gridcraft', 'deckcraft', 'pdfcraft'] },
  { id: 'explainer-video', delivers: 'a narrated video from slides', crafts: ['deckcraft', 'filmcraft', 'soundcraft'] },
  { id: 'motion', delivers: 'a motion-graphics piece cut with the video', crafts: ['effectcraft', 'filmcraft'] },
  { id: 'brand-kit', delivers: 'a design system turned into a brand book', crafts: ['figcraft', 'vectorcraft', 'designcraft'] },
  { id: 'photo-pipeline', delivers: 'raw files developed and retouched for web and print', crafts: ['lightcraft', 'photocraft'] },
  { id: 'print-layout', delivers: 'a print-ready layout with images and graphics', crafts: ['photocraft', 'vectorcraft', 'designcraft'] },
  { id: 'cad-set', delivers: 'a drawing set delivered as one PDF', crafts: ['cadcraft', 'pdfcraft'] },
  { id: 'texture-kit', delivers: 'PBR maps baked and packed for a 3D asset', crafts: ['texturecraft', 'photocraft'] },
]

/** Packages that improve every craft. */
export const SUITE_COMPANIONS: readonly SuiteCompanion[] = [
  {
    id: 'preview-panel',
    package: 'dsh-artcraft-preview-panel',
    why: 'shows each step of the document inside the DSH Web GUI, and starts the local preview server',
  },
  {
    id: 'skills',
    package: 'dsh-artcraft-skills',
    why: 'the workflows themselves (report, brand kit, explainer video, drawing set, conversion) as agent skills',
  },
]

/**
 * Missing crafts of the workflows a user has already started.
 * @param installed - craft ids currently installed.
 * @returns one entry per missing craft, best-completing workflow first.
 */
export function suggestCrafts(installed: readonly string[]): { craft: string; forWorkflow: string; delivers: string; has: number; needs: number }[] {
  const have = new Set(installed)
  const missing = new Map<string, { craft: string; forWorkflow: string; delivers: string; has: number; needs: number }>()
  for (const workflow of SUITE_WORKFLOWS) {
    const present = workflow.crafts.filter(craft => have.has(craft))
    if (present.length === 0 || present.length === workflow.crafts.length) continue
    for (const craft of workflow.crafts) {
      if (have.has(craft)) continue
      const existing = missing.get(craft)
      const candidate = { craft, forWorkflow: workflow.id, delivers: workflow.delivers, has: present.length, needs: workflow.crafts.length }
      if (existing === undefined || candidate.has / candidate.needs > existing.has / existing.needs) missing.set(craft, candidate)
    }
  }
  return [...missing.values()].sort((a, b) => b.has / b.needs - a.has / a.needs || a.craft.localeCompare(b.craft))
}

/**
 * The workflows one craft takes part in.
 * @param craft - craft id.
 * @returns the workflows containing it.
 */
export function workflowsOf(craft: string): SuiteWorkflow[] {
  return SUITE_WORKFLOWS.filter(workflow => workflow.crafts.includes(craft))
}
