#!/usr/bin/env node
/**
 * Doctor: what this machine has, what it is missing, and what to install next.
 *
 * A user often installs one craft and then tries a workflow that needs two more.
 * This reports the whole suite in one place — craft plugins, the preview panel,
 * the skills, and the CLIs each plugin drives — and recommends the missing
 * partners of the workflows that are already half-installed.
 *
 * Everything is plain Node with `node:path` and no shell: Windows, macOS and
 * Linux take the same path through this file.
 *
 * Usage:
 *   node scripts/doctor.mjs
 *   node scripts/doctor.mjs --json
 *   node scripts/doctor.mjs --dsh-home /path/to/.dsh --profile web
 * @module scripts/doctor
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const value = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : argv[index + 1]
}
const asJson = argv.includes('--json')

const dshHome = resolve(value('--dsh-home', process.env.DSH_HOME ?? join(homedir(), '.dsh')))
const requestedProfile = value('--profile', undefined)

// The suite graph is part of the kernel and stays in plain ESM so this script
// needs no build step.
const suite = await import(pathToFileURL(join(root, 'dsh-plugins', 'craft-kit', 'lib', 'suite.js')).href)
const profilesModule = await import(pathToFileURL(join(root, 'dsh-plugins', 'craft-kit', 'src', 'profiles.mjs')).href)
const PROFILES = profilesModule.CRAFT_PROFILES
const CRAFT_IDS = PROFILES.map(profile => profile.id)

/** The binary name a craft ships on this platform. */
function binaryName(craft) {
  return process.platform === 'win32' ? `${craft}-cli.exe` : `${craft}-cli`
}

/** Every directory a CLI could be in, most specific first. */
function cliDirs() {
  const dirs = [join(dshHome, 'crafts', 'bin'), join(root, 'crafts-bin'), join(root, 'bin')]
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry.trim().length > 0) dirs.push(entry)
  }
  return dirs
}

/** Which craft CLIs are on this machine. */
function detectedClis() {
  const dirs = cliDirs()
  const found = {}
  for (const craft of CRAFT_IDS) {
    const name = binaryName(craft)
    for (const dir of dirs) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) { found[craft] = candidate; break }
    }
  }
  return found
}

/** Every profile that contains at least one ArtCraft package. */
function scanProfiles() {
  const profilesRoot = join(dshHome, 'profiles')
  if (!existsSync(profilesRoot)) return []
  const out = []
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (requestedProfile !== undefined && entry.name !== requestedProfile) continue
    const nodeModules = join(profilesRoot, entry.name, 'node_modules')
    if (!existsSync(nodeModules)) continue
    const crafts = []
    let panel = undefined
    for (const module of readdirSync(nodeModules, { withFileTypes: true })) {
      if (!module.isDirectory()) continue
      if (!module.name.startsWith('dsh-artcraft-')) continue
      const manifestPath = join(nodeModules, module.name, 'package.json')
      if (!existsSync(manifestPath)) continue
      let manifest
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      } catch {
        continue
      }
      if (manifest.name === 'dsh-artcraft-preview-panel') { panel = manifest.version; continue }
      const craft = manifest.name.replace(/^dsh-artcraft-plugin-/, '')
      if (CRAFT_IDS.includes(craft)) crafts.push({ craft, version: manifest.version })
    }
    if (crafts.length > 0 || panel !== undefined) out.push({ profile: entry.name, crafts, panel })
  }
  return out
}

/** Which ArtCraft skills are installed in the user skills directory. */
function detectedSkills() {
  const dir = join(dshHome, 'skills')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('artcraft'))
    .map(entry => entry.name)
    .sort()
}

const clis = detectedClis()
const profiles = scanProfiles()
const skills = detectedSkills()

// The union across profiles: a user may have split an install, and the advice
// should still describe the whole machine.
const installedCrafts = [...new Set(profiles.flatMap(entry => entry.crafts.map(craft => craft.craft)))].sort()
const panelInstalled = profiles.some(entry => entry.panel !== undefined)
const suggestions = suite.suggestCrafts(installedCrafts)

const report = {
  platform: `${process.platform}/${process.arch}`,
  dshHome,
  profiles,
  installedCrafts,
  clis: { found: clis, missing: CRAFT_IDS.filter(craft => clis[craft] === undefined) },
  companions: {
    previewPanel: panelInstalled,
    skills,
  },
  workflowSuggestions: suggestions,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const line = (text = '') => console.log(text)
line(`platform      ${report.platform}`)
line(`dsh home      ${report.dshHome}`)
line()

if (profiles.length === 0) {
  line('No ArtCraft plugin is installed in any profile under this dsh home.')
  line('Install one:  dsh plugin --profile web add dsh-artcraft-plugin-gridcraft')
} else {
  line('Profiles')
  for (const entry of profiles) {
    const crafts = entry.crafts.map(craft => `${craft.craft}@${craft.version}`).join(', ') || '(none)'
    line(`  ${entry.profile}: ${crafts}${entry.panel === undefined ? '' : ` | preview-panel@${entry.panel}`}`)
  }
}

line()
line('Craft CLIs')
const cliKnown = CRAFT_IDS.filter(craft => clis[craft] !== undefined)
line(`  found ${cliKnown.length}/${CRAFT_IDS.length}${report.clis.missing.length === 0 ? '' : ` — missing: ${report.clis.missing.join(', ')}`}`)
if (report.clis.missing.length > 0) line('  install:  node scripts/install-craft.mjs')

line()
line('Suite companions')
line(`  preview panel: ${panelInstalled ? 'installed' : 'not installed — `dsh plugin add dsh-artcraft-preview-panel`'}`)
line(`  skills:        ${skills.length === 0 ? 'not installed — `node scripts/install.mjs` from dsh-artcraft-skills' : skills.join(', ')}`)

if (suggestions.length > 0) {
  line()
  line('Install next')
  for (const suggestion of suggestions) {
    line(`  ${suggestion.craft.padEnd(14)} completes "${suggestion.forWorkflow}" (${suggestion.delivers}) — ${suggestion.has}/${suggestion.needs} installed`)
  }
  line('  all:  dsh plugin --profile web add ' + suggestions.slice(0, 3).map(s => `dsh-artcraft-plugin-${s.craft}`).join(' '))
}

line()
const missingClis = CRAFT_IDS.filter(craft => installedCrafts.includes(craft) && clis[craft] === undefined)
if (missingClis.length > 0) {
  line(`Note: ${missingClis.join(', ')} installed as plugins but their CLI is not on this machine — those tools will report the missing binary.`)
} else {
  line('Everything installed is ready to use.')
}
