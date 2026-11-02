/**
 * A readable work journal for the craft tools.
 *
 * The harness shows each tool call, but a session that builds a report spans a
 * dozen calls across four applications, and reconstructing what actually happened
 * means scrolling a transcript. Every call also appends one line to a per-craft
 * journal in the workspace (`.artcraft/journal/`), so the user can open one file
 * and read the story: which craft, which operation, how long, what came out.
 *
 * A journal line is best-effort and never fails a tool call: a read-only
 * workspace loses the record, not the work.
 * @module @dsh-artcraft/craft-kit/journal
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
                                              

/** One recorded event. */
                               
                                   
                     
                                            
                       
                                                                        
                          
                                          
                                        
 

/** Where the journals live, relative to the workspace the agent runs in. */
export function journalDir(cwd         = process.cwd())         {
  return join(cwd, '.artcraft', 'journal')
}

/**
 * Append one entry to the craft's journal.
 * @param profile - the craft that ran.
 * @param entry - what happened.
 * @param cwd - workspace root; defaults to the process cwd.
 */
export function appendJournal(profile              , entry              , cwd         = process.cwd())       {
  try {
    const dir = journalDir(cwd)
    mkdirSync(dir, { recursive: true })
    const time = new Date(entry.at).toTimeString().slice(0, 8)
    const artifacts = entry.artifacts !== undefined && entry.artifacts.length > 0
      ? `\n  → ${entry.artifacts.join(', ')}`
      : ''
    appendFileSync(join(dir, `${profile.id}.md`), `${time} · ${entry.kind} · ${entry.summary}${artifacts}\n`)
    appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ craft: profile.id, ...entry }) + '\n')
  } catch {
    // A journal is a convenience; never let it fail the call that produced it.
  }
}
