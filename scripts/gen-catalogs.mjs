#!/usr/bin/env node
/**
 * Snapshot every craft's command catalog to disk.
 *
 * Snapshots serve two purposes: they let `*_commands` answer usefully before
 * the matching CLI is installed, and they make the catalogs diffable in review
 * so a craft upgrade's command-surface change is visible.
 *
 * Usage: node scripts/gen-catalogs.mjs [craftId ...]
 * @module scripts/gen-catalogs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModule } from './lib/host.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kit = await loadModule(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'index.js'))

const requested = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const profiles = requested.length > 0
  ? requested.map(id => kit.profileOf(id)).filter(Boolean)
  : kit.CRAFT_PROFILES

const catalogDir = join(root, 'dsh-plugins', 'craft-kit', 'catalog')
mkdirSync(catalogDir, { recursive: true })

const binaries = {}
let ok = 0
for (const profile of profiles) {
  const runtime = kit.createRuntime(profile, join(root, 'dsh-plugins', 'craft-kit'), {})
  const binary = runtime.binary()
  if (binary === undefined) {
    console.error(`${profile.id.padEnd(14)} no binary — skipped`)
    continue
  }
  const catalog = await runtime.catalog()
  const entries = catalog.commands.map(command => ({
    id: command.id,
    ...command.label !== undefined ? { label: command.label } : {},
    ...command.params !== undefined ? { params: command.params } : {},
    ...command.menu !== undefined ? { menu: command.menu } : {},
    ...command.shortcut !== undefined ? { shortcut: command.shortcut } : {},
    ...command.aliases !== undefined ? { aliases: command.aliases } : {},
    ...command.enabled !== undefined ? { enabled: command.enabled } : {},
    ...command.description !== undefined ? { description: command.description } : {},
  }))
  writeFileSync(join(catalogDir, `${profile.id}.json`), JSON.stringify(entries, undefined, 1) + '\n')
  binaries[profile.id] = binary.path
  console.log(`${profile.id.padEnd(14)} ${String(entries.length).padStart(4)} commands  ${catalog.origin}  ${binary.version ?? ''}`)
  ok += 1
}

writeFileSync(join(catalogDir, 'binaries.json'), JSON.stringify(binaries, undefined, 2) + '\n')
console.log(`\nwrote ${ok} catalog snapshot(s) to dsh-plugins/craft-kit/catalog/`)
