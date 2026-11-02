#!/usr/bin/env node
/**
 * Validate the skills in `skills/` before they are installed.
 *
 * DSH discovers skills by reading the YAML frontmatter of `SKILL.md`. A malformed
 * frontmatter does not fail loudly: the skill is simply absent from the model's
 * catalogue, so a typo looks exactly like a skill that was never written. The
 * common typo is an unquoted description containing ": " — YAML reads the rest of
 * the line as a nested key and the whole document fails to parse.
 *
 * Usage: node scripts/validate-skills.mjs
 * @module scripts/validate-skills
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(dirname(import.meta.url.replace('file://', '')), '..')
const skillsRoot = join(root, 'skills')

/** Locate js-yaml from the harness checkout this repository already needs. */
function findYaml() {
  const candidates = [
    process.env.DSH_HARNESS_DIR,
    join(root, '..', 'deepseek-harness'),
    join(process.env.HOME ?? '', 'deepseek-harness'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    const moduleDir = join(candidate, 'node_modules', 'js-yaml')
    if (existsSync(moduleDir)) return pathToFileURL(join(moduleDir, 'dist', 'js-yaml.mjs')).href
  }
  return undefined
}

const yamlUrl = findYaml()
if (yamlUrl === undefined) {
  console.error('js-yaml not found — set DSH_HARNESS_DIR to a deepseek-harness checkout.')
  process.exit(2)
}
const yaml = await import(yamlUrl)

const dirs = readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
let failures = 0

for (const entry of dirs) {
  const file = join(skillsRoot, entry.name, 'SKILL.md')
  if (!existsSync(file)) {
    console.error(`✗ ${entry.name}: no SKILL.md`)
    failures += 1
    continue
  }
  const raw = readFileSync(file, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (frontmatter === null) {
    console.error(`✗ ${entry.name}: SKILL.md does not start with a YAML frontmatter block`)
    failures += 1
    continue
  }
  let meta
  try {
    meta = yaml.load(frontmatter[1])
  } catch (error) {
    console.error(`✗ ${entry.name}: frontmatter does not parse — ${error.message.split('\n')[0]}`)
    console.error('    A description containing ": " must be quoted, e.g. description: "Use when …: …"')
    failures += 1
    continue
  }
  const problems = []
  if (typeof meta?.name !== 'string' || meta.name.length === 0) problems.push('frontmatter needs a name')
  if (typeof meta?.description !== 'string' || meta.description.trim().length === 0) problems.push('frontmatter needs a description')
  else if (meta.description.length > 1024) problems.push('description is longer than 1024 characters')
  if (problems.length === 0) {
    console.log(`✓ ${entry.name} (${meta.name}) — ${meta.description.length} char description`)
  } else {
    failures += 1
    console.error(`✗ ${entry.name}`)
    for (const problem of problems) console.error(`    ${problem}`)
  }
}

console.log(failures === 0
  ? `\nall ${dirs.length} skill(s) are valid`
  : `\n${failures} of ${dirs.length} skill(s) have problems`)
process.exit(failures === 0 ? 0 : 1)
