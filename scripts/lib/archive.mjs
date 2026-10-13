/**
 * Minimal ZIP and tar.gz member extraction using only Node built-ins.
 *
 * The craft archives are read on stock Windows and minimal Linux images where
 * `unzip`, `tar` and `7z` may all be absent, so both containers are parsed here.
 * Only the single CLI member is ever written to disk, which also keeps a 20 MB
 * application archive from unpacking into a home directory.
 * @module scripts/lib/archive
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

/** Read a tar archive's members from a `.tar.gz` or `.tar` file. */
function tarEntries(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    // Two consecutive zero blocks end the archive.
    if (header.every(byte => byte === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeField = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = sizeField.length === 0 ? 0 : Number.parseInt(sizeField, 8)
    const typeFlag = String.fromCharCode(header[156])
    // GNU long names arrive as a '././@LongLink' member before the real entry.
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const fullName = prefix.length > 0 ? `${prefix}/${name}` : name
    const dataStart = offset + 512
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      entries.push({ path: fullName, data: buffer.subarray(dataStart, dataStart + size) })
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

/** Read a zip archive's central directory and inflate one entry's data. */
function zipEntries(buffer) {
  // Locate the End Of Central Directory record, scanning back over any comment.
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65_536; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd === -1) throw new Error('not a zip archive: no end-of-central-directory record')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const path = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    // The local header repeats the name and extra lengths, which vary from the
    // central copy; the data starts after the local ones.
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    if (method === 0) entries.push({ path, data: raw })
    else if (method === 8) entries.push({ path, data: inflateRawSync(raw) })
    // Other methods (bzip2, lzma) never appear in these release archives.
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Extract the one archive member matching a target's predicate.
 *
 * Tar streams are sequential, so a match can be returned as soon as it is seen
 * and the rest of a 300 MB archive stays compressed in memory only once.
 * @param archivePath - the `.zip`, `.tar.gz` or `.tar` file.
 * @param scratchDir - directory the member is written into (created if needed).
 * @param target - `{ container, match }` describing what to look for.
 * @param craft - the craft id, passed through to `match`.
 * @returns the absolute path of the extracted member.
 * @throws when the archive holds no matching member.
 */
export function extractFromArchive(archivePath, scratchDir, target, craft) {
  rmSync(scratchDir, { recursive: true, force: true })
  mkdirSync(scratchDir, { recursive: true })
  const raw = readFileSync(archivePath)

  if (target.container === 'tar.gz') {
    const tar = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
    for (const entry of tarEntries(tar)) {
      if (entry.path.endsWith('/')) continue
      if (!target.match(craft, entry.path)) continue
      const out = join(scratchDir, 'member')
      mkdirSync(dirname(out), { recursive: true })
      // Synchronous write: the caller needs the file on disk immediately, and a
      // single CLI binary is a few tens of megabytes at most.
      writeFileSync(out, entry.data)
      return out
    }
  } else {
    for (const entry of zipEntries(raw)) {
      if (!target.match(craft, entry.path)) continue
      const out = join(scratchDir, 'member')
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, entry.data)
      return out
    }
  }
  throw new Error(`no CLI member matched inside ${archivePath}`)
}
