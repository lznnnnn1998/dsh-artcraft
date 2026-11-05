#!/usr/bin/env node
/**
 * Delete the recorded preview state.
 *
 * The images and `state.json` under the preview root are derived data: they are
 * rebuilt by the next call that renders a document. This exists so a stale
 * filmstrip (old test runs, a renamed document) can be cleared without hunting
 * for the directory by hand.
 *
 * Usage:
 *   node scripts/preview/reset.mjs          # show what would be deleted
 *   node scripts/preview/reset.mjs --yes    # delete it
 * @module scripts/preview/reset
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const confirmed = args.includes('--yes')
const dshHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
const root = resolve(process.env.DSH_ARTCRAFT_PREVIEW_DIR?.trim() || join(dshHome, 'artcraft', 'preview'))

if (!existsSync(root)) {
  console.log(`nothing to clear: ${root} does not exist`)
  process.exit(0)
}

const crafts = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
const steps = crafts.reduce((total, craft) => {
  try {
    const state = JSON.parse(readFileSync(join(root, craft, 'state.json'), 'utf8'))
    return total + (Array.isArray(state.steps) ? state.steps.length : 0)
  } catch {
    return total
  }
}, 0)

console.log(`preview root: ${root}`)
console.log(`  crafts: ${crafts.length}${crafts.length === 0 ? '' : ` (${crafts.join(', ')})`}`)
console.log(`  steps:  ${steps}`)

if (!confirmed) {
  console.log('\nnothing deleted; run with --yes to remove it')
  process.exit(0)
}

rmSync(root, { recursive: true, force: true })
console.log(`\nremoved ${root}`)
