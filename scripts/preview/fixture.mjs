#!/usr/bin/env node
/**
 * Write a plausible preview state tree for the layer B panel.
 *
 * The fixture exists so `scripts/preview/server.mjs` and `panel.html` can be
 * exercised without an agent or a craft binary. It crops the real report page
 * out of `docs/screenshots/live-preview-panel.png`, resizes it into the
 * step/thumb pairs the contract asks for, draws a couple of synthetic slide and
 * video frames, and writes a text-only SoundCraft entry to cover the no-image
 * path. Everything is written under /tmp by default and may be deleted freely.
 *
 * Usage:
 *   node scripts/preview/fixture.mjs [--out DIR] [--quiet]
 * @module scripts/preview/fixture
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const SHOTS = join(REPO, 'docs', 'screenshots')
const TMP_ROOT = existsSync('/tmp') ? '/tmp' : tmpdir()
const DEFAULT_OUT = join(TMP_ROOT, 'artcraft-preview-fixture')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, quiet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const equals = argument.indexOf('=')
    const flag = equals === -1 ? argument : argument.slice(0, equals)
    const inline = equals === -1 ? undefined : argument.slice(equals + 1)

    if (flag === '--out') {
      const value = inline ?? argv[++index]
      if (value === undefined || value === '') {
        console.error('fixture: --out needs a path')
        process.exit(2)
      }
      options.out = resolve(value)
    } else if (flag === '--quiet') {
      options.quiet = true
    } else if (flag === '--help' || flag === '-h') {
      console.log('Usage: node scripts/preview/fixture.mjs [--out DIR] [--quiet]')
      process.exit(0)
    } else {
      console.error(`fixture: unknown argument ${argument}`)
      process.exit(2)
    }
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
const OUT = options.out
if (OUT === '/' || OUT === homedir()) {
  console.error('fixture: refusing to use the filesystem root or home directory as --out')
  process.exit(2)
}

const CRAFTS = ['wordcraft', 'deckcraft', 'soundcraft', 'filmcraft']
mkdirSync(OUT, { recursive: true })
// Only remove what this fixture owns; never sweep unrelated files in --out.
for (const craft of CRAFTS) rmSync(join(OUT, craft), { recursive: true, force: true })
rmSync(join(OUT, 'index.json'), { force: true })

// ---------------------------------------------------------------------------
// Minimal PNG codec (8-bit, non-interlaced) — no dependencies.
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PNG_COLOR_TYPE = { 0: 'gray', 2: 'rgb', 3: 'palette', 4: 'gray+alpha', 6: 'rgba' }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    c = CRC_TABLE[(c ^ buffer[index]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilterScanline(line, previous, bytesPerPixel, filter) {
  switch (filter) {
    case 0:
      break
    case 1:
      for (let i = bytesPerPixel; i < line.length; i += 1) {
        line[i] = (line[i] + line[i - bytesPerPixel]) & 0xff
      }
      break
    case 2:
      for (let i = 0; i < line.length; i += 1) line[i] = (line[i] + previous[i]) & 0xff
      break
    case 3:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff
      }
      break
    case 4:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0
        const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0
        line[i] = (line[i] + paeth(left, previous[i], upLeft)) & 0xff
      }
      break
    default:
      throw new Error(`unsupported PNG filter ${filter}`)
  }
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file')

  let offset = 8
  let header = null
  let palette = null
  const dataChunks = []

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    offset += 12 + length

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'IDAT') {
      dataChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
  }

  if (header === null) throw new Error('PNG has no IHDR')
  if (header.bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${header.bitDepth}`)
  if (header.interlace !== 0) throw new Error('interlaced PNG is not supported')
  const channels = PNG_CHANNELS[header.colorType]
  if (channels === undefined) throw new Error(`unsupported PNG color type ${header.colorType}`)
  if (header.colorType === 3 && palette === null) throw new Error('palette PNG has no PLTE')

  const raw = inflateSync(Buffer.concat(dataChunks))
  const stride = header.width * channels
  const pixels = Buffer.alloc(header.width * header.height * 4)
  let previous = Buffer.alloc(stride)
  let position = 0

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[position]
    position += 1
    const line = Buffer.from(raw.subarray(position, position + stride))
    position += stride
    unfilterScanline(line, previous, channels, filter)

    for (let x = 0; x < header.width; x += 1) {
      let r
      let g
      let b
      let a = 255
      if (header.colorType === 2) {
        r = line[x * 3]; g = line[x * 3 + 1]; b = line[x * 3 + 2]
      } else if (header.colorType === 6) {
        r = line[x * 4]; g = line[x * 4 + 1]; b = line[x * 4 + 2]; a = line[x * 4 + 3]
      } else if (header.colorType === 0) {
        r = line[x]; g = line[x]; b = line[x]
      } else if (header.colorType === 4) {
        r = line[x * 2]; g = line[x * 2]; b = line[x * 2]; a = line[x * 2 + 1]
      } else {
        const index = line[x] * 3
        r = palette[index]; g = palette[index + 1]; b = palette[index + 2]
      }
      const target = (y * header.width + x) * 4
      pixels[target] = r
      pixels[target + 1] = g
      pixels[target + 2] = b
      pixels[target + 3] = a
    }
    previous = line
  }

  return { width: header.width, height: header.height, data: pixels, colorType: PNG_COLOR_TYPE[header.colorType] }
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 'latin1')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), data.length + 8)
  return chunk
}

function encodePng(image) {
  const { width, height, data } = image
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Image operations
// ---------------------------------------------------------------------------

function createImage(width, height, color = [0, 0, 0, 255]) {
  const image = { width, height, data: Buffer.alloc(width * height * 4) }
  fillRect(image, 0, 0, width, height, color)
  return image
}

function blendPixel(image, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height || alpha <= 0) return
  const index = (y * image.width + x) * 4
  const a = Math.max(0, Math.min(1, alpha))
  image.data[index] = Math.round(image.data[index] * (1 - a) + color[0] * a)
  image.data[index + 1] = Math.round(image.data[index + 1] * (1 - a) + color[1] * a)
  image.data[index + 2] = Math.round(image.data[index + 2] * (1 - a) + color[2] * a)
  image.data[index + 3] = 255
}

function fillRect(image, x, y, width, height, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(image.width, Math.floor(x + width))
  const y1 = Math.min(image.height, Math.floor(y + height))
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) blendPixel(image, px, py, color, alpha)
  }
}

function verticalGradient(image, top, bottom) {
  for (let y = 0; y < image.height; y += 1) {
    const t = image.height <= 1 ? 0 : y / (image.height - 1)
    const color = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ]
    fillRect(image, 0, y, image.width, 1, color)
  }
}

function glow(image, cx, cy, radius, color, strength = 0.6) {
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(image.width, Math.ceil(cx + radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(image.height, Math.ceil(cy + radius))
  const radiusSquared = radius * radius
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2
      if (distanceSquared > radiusSquared) continue
      const falloff = 1 - Math.sqrt(distanceSquared) / radius
      blendPixel(image, x, y, color, strength * falloff * falloff)
    }
  }
}

function cropImage(image, x, y, width, height) {
  const sx = Math.max(0, Math.min(image.width - 1, Math.floor(x)))
  const sy = Math.max(0, Math.min(image.height - 1, Math.floor(y)))
  const sw = Math.max(1, Math.min(image.width - sx, Math.floor(width)))
  const sh = Math.max(1, Math.min(image.height - sy, Math.floor(height)))
  const output = { width: sw, height: sh, data: Buffer.alloc(sw * sh * 4) }
  for (let row = 0; row < sh; row += 1) {
    image.data.copy(output.data, row * sw * 4, ((sy + row) * image.width + sx) * 4, ((sy + row) * image.width + sx + sw) * 4)
  }
  return output
}

function resizeToWidth(image, targetWidth) {
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round((image.height / image.width) * width))
  const output = { width, height, data: Buffer.alloc(width * height * 4) }
  const scaleX = image.width / width
  const scaleY = image.height / height

  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5
    const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(sourceY)))
    const y1 = Math.max(0, Math.min(image.height - 1, y0 + 1))
    const wy = Math.max(0, Math.min(1, sourceY - y0))
    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5
      const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(sourceX)))
      const x1 = Math.max(0, Math.min(image.width - 1, x0 + 1))
      const wx = Math.max(0, Math.min(1, sourceX - x0))
      const target = (y * width + x) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = image.data[(y0 * image.width + x0) * 4 + channel]
        const topRight = image.data[(y0 * image.width + x1) * 4 + channel]
        const bottomLeft = image.data[(y1 * image.width + x0) * 4 + channel]
        const bottomRight = image.data[(y1 * image.width + x1) * 4 + channel]
        const top = topLeft + (topRight - topLeft) * wx
        const bottom = bottomLeft + (bottomRight - bottomLeft) * wx
        output.data[target + channel] = Math.round(top + (bottom - top) * wy)
      }
    }
  }
  return output
}

/**
 * The mock screenshot contains the report page as a large near-white rectangle.
 * Find it so the fixture can use the real render instead of a fake white box.
 */
function findWhiteBox(image, threshold = 248, region = { x0: 0.3, x1: 0.8, y0: 0.05, y1: 0.87 }) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  const startX = Math.floor(image.width * region.x0)
  const endX = Math.ceil(image.width * region.x1)
  const startY = Math.floor(image.height * region.y0)
  const endY = Math.ceil(image.height * region.y1)
  // Only the centre canvas is searched: the mock's filmstrip and side panels
  // contain their own near-white pixels.
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * image.width + x) * 4
      if (image.data[index] >= threshold && image.data[index + 1] >= threshold && image.data[index + 2] >= threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

// ---------------------------------------------------------------------------
// Synthetic renders (the screenshots only contain one real page)
// ---------------------------------------------------------------------------

function makeDocumentPage(width = 918, height = 1188) {
  const image = createImage(width, height, [255, 255, 255, 255])
  fillRect(image, 76, 88, width * 0.58, 22, [38, 52, 74])
  fillRect(image, 76, 124, width * 0.4, 10, [150, 160, 175])
  fillRect(image, 76, 180, width - 152, 1, [224, 228, 234])
  for (let index = 0; index < 7; index += 1) {
    fillRect(image, 76, 208 + index * 26, (width - 152) * (index === 6 ? 0.55 : 0.92 - (index % 3) * 0.04), 7, [128, 138, 152])
  }
  const chartTop = Math.round(height * 0.46)
  fillRect(image, 76, chartTop - 28, width - 152, 1, [224, 228, 234])
  const chartHeight = Math.round(height * 0.24)
  const barWidth = Math.round((width - 152) / 14)
  for (let index = 0; index < 5; index += 1) {
    const barHeight = chartHeight * (0.42 + (index % 3) * 0.18)
    fillRect(image, 120 + index * barWidth * 2.4, chartTop + chartHeight - barHeight, barWidth, barHeight, [31, 113, 145])
  }
  for (let index = 0; index < 6; index += 1) {
    fillRect(image, 100, chartTop + (chartHeight / 5) * index, width - 200, 1, [232, 235, 240])
  }
  fillRect(image, 76, height - 120, width - 152, 7, [190, 197, 208])
  fillRect(image, 76, height - 100, width * 0.42, 7, [205, 211, 220])
  return image
}

function makeSlide(kind) {
  const width = 1600
  const height = 900
  const image = createImage(width, height, [10, 13, 20, 255])
  verticalGradient(image, [16, 23, 40], [8, 11, 18])
  glow(image, width * 0.84, height * 0.26, 460, [58, 92, 182], 0.42)
  glow(image, width * 0.12, height * 0.9, 300, [40, 74, 92], 0.3)

  fillRect(image, 120, 176, 16, 540, [91, 140, 255])
  if (kind === 'title') {
    fillRect(image, 186, 214, 820, 52, [232, 236, 244])
    fillRect(image, 186, 290, 660, 52, [232, 236, 244])
    fillRect(image, 186, 402, 540, 15, [126, 145, 174])
    fillRect(image, 186, 436, 430, 15, [96, 112, 138])
    fillRect(image, 186, 540, 170, 46, [91, 140, 255])
    fillRect(image, 244, 557, 54, 12, [13, 17, 26])
  } else {
    fillRect(image, 186, 150, 620, 30, [232, 236, 244])
    fillRect(image, 186, 200, 380, 12, [118, 134, 160])
    const chartLeft = 190
    const chartRight = width - 150
    const baseline = 700
    const chartHeight = 330
    for (let index = 0; index <= 5; index += 1) {
      fillRect(image, chartLeft, baseline - (chartHeight / 5) * index, chartRight - chartLeft, 1, [40, 51, 70])
    }
    const values = [0.34, 0.52, 0.45, 0.67, 0.58, 0.76, 0.69, 0.86]
    const slot = (chartRight - chartLeft) / values.length
    values.forEach((value, index) => {
      const barHeight = Math.round(value * chartHeight)
      const x = chartLeft + index * slot + slot * 0.24
      fillRect(image, x, baseline - barHeight, slot * 0.5, barHeight, [45, 148, 168])
      fillRect(image, x, baseline - barHeight, slot * 0.5, 8, [96, 200, 207])
    })
    fillRect(image, chartLeft, baseline, chartRight - chartLeft, 2, [70, 86, 110])
  }

  fillRect(image, 120, 770, width - 240, 2, [39, 52, 75])
  fillRect(image, 120, 800, 190, 10, [91, 140, 255])
  fillRect(image, 330, 800, 280, 10, [46, 58, 82])
  fillRect(image, width - 250, 800, 130, 10, [46, 58, 82])
  return image
}

function makeVideoFrame(kind) {
  const width = 1280
  const height = 720
  const image = createImage(width, height, [5, 8, 14, 255])
  verticalGradient(image, kind === 'sunset' ? [30, 26, 48] : [10, 26, 34], [5, 7, 12])

  const sunX = kind === 'sunset' ? 940 : 360
  const sunY = 250
  glow(image, sunX, sunY, 300, kind === 'sunset' ? [232, 146, 74] : [76, 180, 164], 0.5)
  glow(image, sunX, sunY, 120, kind === 'sunset' ? [255, 206, 138] : [150, 240, 220], 0.7)
  fillRect(image, 0, 470, width, 250, kind === 'sunset' ? [14, 12, 20] : [5, 13, 17])
  fillRect(image, 0, 468, width, 4, kind === 'sunset' ? [96, 62, 48] : [30, 78, 74])

  // A few foreground silhouettes; abstract, but reads as a still frame.
  fillRect(image, 130, 360, 90, 140, [12, 13, 18])
  fillRect(image, 250, 320, 60, 180, [10, 11, 16])
  fillRect(image, 330, 390, 120, 110, [12, 13, 18])
  fillRect(image, 820, 380, 70, 120, [10, 12, 16])
  fillRect(image, 910, 340, 46, 160, [9, 10, 14])

  fillRect(image, 0, 0, width, 44, [0, 0, 0])
  fillRect(image, 0, height - 44, width, 44, [0, 0, 0])
  fillRect(image, 52, height - 30, 220, 8, [42, 50, 64])
  fillRect(image, width - 180, height - 30, 128, 8, [42, 50, 64])
  return image
}

// ---------------------------------------------------------------------------
// Fixture writing
// ---------------------------------------------------------------------------

function iso(ms) {
  return new Date(ms).toISOString()
}

function writePng(file, image) {
  writeFileSync(file, encodePng(image))
}

function writeRender(craft, n, image) {
  const directory = join(OUT, craft)
  mkdirSync(directory, { recursive: true })
  const stem = String(n).padStart(3, '0')
  const imageName = `step-${stem}.png`
  const thumbName = `thumb-${stem}.png`
  writePng(join(directory, imageName), image)
  writePng(join(directory, thumbName), resizeToWidth(image, 320))
  return {
    image: imageName,
    thumb: thumbName,
    width: image.width,
    height: image.height,
  }
}

function writeState(craft, state) {
  const directory = join(OUT, craft)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'state.json'), `${JSON.stringify(state, null, 2)}\n`)
}

// Pick the real report page out of the design mock. If that fails (or the
// screenshot is moved) fall back to a synthetic document page.
let page
let pageSource = 'synthetic document page'
try {
  const mock = decodePng(readFileSync(join(SHOTS, 'live-preview-panel.png')))
  const box = findWhiteBox(mock)
  if (box !== null && box.width > 300 && box.height > 500) {
    page = cropImage(mock, box.x + 2, box.y + 2, box.width - 4, box.height - 4)
    pageSource = `cropped from docs/screenshots/live-preview-panel.png (${box.width}×${box.height})`
  }
} catch (error) {
  if (!options.quiet) console.warn(`fixture: could not use the mock screenshot (${error.message})`)
}
if (page === undefined) page = makeDocumentPage()

const pageTop = cropImage(page, 0, 0, page.width, Math.round(page.height * 0.72))
const pageChart = cropImage(
  page,
  Math.round(page.width * 0.07),
  Math.round(page.height * 0.33),
  Math.round(page.width * 0.86),
  Math.round(page.height * 0.34),
)

const titleSlide = makeSlide('title')
const chartSlide = makeSlide('chart')
const sunsetFrame = makeVideoFrame('sunset')
const tealFrame = makeVideoFrame('teal')

const now = Date.now()
const wordcraftAt = [now - 7400, now - 5600, now - 3600, now - 1700, now - 350]
const wordcraftRenders = [
  writeRender('wordcraft', 1, page),
  writeRender('wordcraft', 2, pageTop),
  writeRender('wordcraft', 3, pageChart),
  writeRender('wordcraft', 4, page),
  writeRender('wordcraft', 5, page),
]
writeState('wordcraft', {
  craft: 'wordcraft',
  product: 'WordCraft',
  file: join(OUT, 'report.docx'),
  pages: 1,
  updatedAt: iso(wordcraftAt[4]),
  current: 5,
  steps: [
    {
      n: 1,
      at: iso(wordcraftAt[0]),
      tool: 'run',
      title: 'WordCraft · import source',
      summary: 'file.open → report.docx · exit 0',
      ...wordcraftRenders[0],
      durationMs: 620,
    },
    {
      n: 2,
      at: iso(wordcraftAt[1]),
      tool: 'run',
      title: 'WordCraft · styles + cover',
      summary: 'apply.style ×6 → report.docx · exit 0',
      ...wordcraftRenders[1],
      durationMs: 430,
    },
    {
      n: 3,
      at: iso(wordcraftAt[2]),
      tool: 'run',
      title: 'WordCraft · title + chart',
      summary: 'insert.chart → report.docx · exit 0 · 191 ms',
      ...wordcraftRenders[2],
      durationMs: 191,
    },
    {
      n: 4,
      at: iso(wordcraftAt[3]),
      tool: 'mcp',
      title: 'WordCraft · page render',
      summary: 'render_page {page:1, scale:1.5} · 918×1188',
      ...wordcraftRenders[3],
      durationMs: 360,
    },
    {
      n: 5,
      at: iso(wordcraftAt[4]),
      tool: 'run',
      title: 'WordCraft · final export',
      summary: 'file.exportPdf → report.pdf · exit 0',
      ...wordcraftRenders[4],
      durationMs: 780,
    },
  ],
})

const deckAt = [now - 52_000, now - 44_000]
const deckRenders = [
  writeRender('deckcraft', 1, titleSlide),
  writeRender('deckcraft', 2, chartSlide),
]
writeState('deckcraft', {
  craft: 'deckcraft',
  product: 'DeckCraft',
  file: join(OUT, 'story.deckcraft'),
  pages: 3,
  updatedAt: iso(deckAt[1]),
  current: 2,
  steps: [
    {
      n: 1,
      at: iso(deckAt[0]),
      tool: 'run',
      title: 'DeckCraft · title slide',
      summary: 'slide.new + text.set → story.deckcraft · exit 0',
      ...deckRenders[0],
      durationMs: 312,
    },
    {
      n: 2,
      at: iso(deckAt[1]),
      tool: 'run',
      title: 'DeckCraft · revenue chart',
      summary: 'insert.chart → story.deckcraft · exit 0',
      ...deckRenders[1],
      durationMs: 188,
    },
  ],
})

const filmAt = [now - 26_000, now - 18_000, now - 7200]
const filmRenders = [
  writeRender('filmcraft', 1, sunsetFrame),
  writeRender('filmcraft', 2, tealFrame),
  writeRender('filmcraft', 3, sunsetFrame),
]
writeState('filmcraft', {
  craft: 'filmcraft',
  product: 'FilmCraft',
  file: join(OUT, 'launch.fcraft'),
  pages: 0,
  updatedAt: iso(filmAt[2]),
  current: 3,
  timeline: [
    { start: 0, duration: 3.2, label: 'clip 1' },
    { start: 3.2, duration: 2.1, label: 'clip 2' },
    { start: 5.3, duration: 2.7, label: 'clip 3', status: 'rendering' },
  ],
  steps: [
    {
      n: 1,
      at: iso(filmAt[0]),
      tool: 'run',
      title: 'FilmCraft · import clips',
      summary: 'media.import → launch.fcraft · 3 clips',
      ...filmRenders[0],
      durationMs: 840,
    },
    {
      n: 2,
      at: iso(filmAt[1]),
      tool: 'run',
      title: 'FilmCraft · colour pass',
      summary: 'effect.apply lut-film → launch.fcraft · exit 0',
      ...filmRenders[1],
      durationMs: 520,
    },
    {
      n: 3,
      at: iso(filmAt[2]),
      tool: 'mcp',
      title: 'FilmCraft · frame export',
      summary: 'file.exportFrame at 0:07 · 1280×720',
      ...filmRenders[2],
      durationMs: 610,
    },
  ],
})

writeState('soundcraft', {
  craft: 'soundcraft',
  product: 'SoundCraft',
  file: join(OUT, 'voice.scraft'),
  pages: 0,
  updatedAt: iso(now - 60_000),
  current: 1,
  steps: [
    {
      n: 1,
      at: iso(now - 60_000),
      tool: 'mix',
      title: 'SoundCraft · mix + bounce',
      summary: 'bounce → voice.wav · exit 0 · 2.4 s',
      durationMs: 2400,
    },
  ],
})

const index = {
  updatedAt: iso(now),
  crafts: {
    wordcraft: {
      file: join(OUT, 'report.docx'),
      pages: 1,
      stepCount: 5,
      updatedAt: iso(wordcraftAt[4]),
    },
    deckcraft: {
      file: join(OUT, 'story.deckcraft'),
      pages: 3,
      stepCount: 2,
      updatedAt: iso(deckAt[1]),
    },
    filmcraft: {
      file: join(OUT, 'launch.fcraft'),
      pages: 0,
      stepCount: 3,
      updatedAt: iso(filmAt[2]),
    },
    soundcraft: {
      file: join(OUT, 'voice.scraft'),
      pages: 0,
      stepCount: 1,
      updatedAt: iso(now - 60_000),
    },
  },
}
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

if (!options.quiet) {
  console.log('')
  console.log('ArtCraft live preview fixture')
  console.log(`  dir     ${OUT}`)
  console.log('  crafts  wordcraft (5 steps) · deckcraft (2) · filmcraft (3 + timeline) · soundcraft (1, text-only)')
  console.log(`  page    ${pageSource}`)
  console.log('')
  console.log(`  run     node scripts/preview/server.mjs --dir ${OUT} --open`)
  console.log('')
}
