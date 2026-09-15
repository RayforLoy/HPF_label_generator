import type opentype from 'opentype.js'
import { buildScaleMarks, circumferenceMm } from './core'
import type { GeneratorConfig, ScaleMark } from './types'

type PathCommand = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export interface Artwork {
  widthMm: number
  heightMm: number
  marks: ScaleMark[]
  svg: string
}

const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

function presentationAngle(angle: number): number {
  if (angle === 0) return 1
  if (angle < 5) return angle * 5
  return angle + 20
}

function makeTextPath(font: opentype.Font, text: string, x: number, baseline: number, size: number, letterSpacingMm = 0): opentype.Path {
  if (letterSpacingMm === 0) return font.getPath(text, x, baseline, size, { kerning: true })
  const combined = font.getPath('', 0, 0, size)
  let cursor = x
  for (const char of text) {
    const glyph = font.charToGlyph(char)
    const path = glyph.getPath(cursor, baseline, size)
    combined.extend(path)
    cursor += (glyph.advanceWidth ?? font.unitsPerEm) / font.unitsPerEm * size + letterSpacingMm
  }
  return combined
}

export function contrastColor(background: string): '#000000' | '#ffffff' {
  const hex = background.replace('#', '')
  const value = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

export function createArtwork(config: GeneratorConfig, font: opentype.Font, horizontal = false): Artwork {
  const widthMm = config.ringWidthMm
  const heightMm = circumferenceMm(config.ringDiameterMm)
  const marks = buildScaleMarks(config)
  const fontSize = config.fontSizeMm
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const frameColor = config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor)
  const nodes: string[] = []

  if (!config.transparentBackground) nodes.push(`<rect width="${widthMm}" height="${heightMm}" fill="${xml(config.backgroundColor)}"/>`)
  if (frameWidthMm > 0) nodes.push(`<rect x="${frameWidthMm / 2}" y="${frameWidthMm / 2}" width="${Math.max(0, widthMm - frameWidthMm)}" height="${Math.max(0, heightMm - frameWidthMm)}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)

  for (const mark of marks) {
    const baseY = mark.angleDeg === 0 ? config.infinityMarginMm : heightMm * presentationAngle(mark.angleDeg) / 360
    const y = Math.min(heightMm - frameWidthMm / 2 - 0.1, Math.max(frameWidthMm / 2 + 0.1, baseY))
    const tickLength = Math.min(widthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    nodes.push(`<line x1="0" y1="${y}" x2="${tickLength}" y2="${y}" stroke="${xml(config.tickColor)}" stroke-width="${config.tickWidthMm}"/>`)
    const labelPath = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize, config.letterSpacingMm)
    nodes.push(`<path d="${labelPath.toPathData(3)}" fill="${xml(config.textColor)}"/>`)
  }

  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const label = `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm`
    const path = makeTextPath(font, label, 0.65, infoY + fontSize, fontSize * 0.82, config.letterSpacingMm)
    nodes.push(`<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`)
  }

  const inner = nodes.join('')
  const viewWidth = horizontal ? heightMm : widthMm
  const viewHeight = horizontal ? widthMm : heightMm
  const transformed = horizontal ? `<g transform="translate(0 ${widthMm}) rotate(-90)">${inner}</g>` : inner
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}mm" height="${viewHeight}mm" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="${xml(config.lensName)} focusing scale">${transformed}</svg>`
  return { widthMm, heightMm, marks, svg }
}

function pointOnQuadratic(p0: number, p1: number, p2: number, t: number) {
  return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2
}

function pointOnCubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
}

function flatten(commands: PathCommand[], segments = 8): Array<Array<[number, number]>> {
  const contours: Array<Array<[number, number]>> = []
  let contour: Array<[number, number]> = []
  let current: [number, number] = [0, 0]
  let start: [number, number] = [0, 0]
  for (const command of commands) {
    if (command.type === 'M') {
      if (contour.length) contours.push(contour)
      current = [command.x!, command.y!]; start = current; contour = [current]
    } else if (command.type === 'L') {
      current = [command.x!, command.y!]; contour.push(current)
    } else if (command.type === 'Q') {
      const from = current
      for (let i = 1; i <= segments; i += 1) {
        const t = i / segments
        contour.push([pointOnQuadratic(from[0], command.x1!, command.x!, t), pointOnQuadratic(from[1], command.y1!, command.y!, t)])
      }
      current = [command.x!, command.y!]
    } else if (command.type === 'C') {
      const from = current
      for (let i = 1; i <= segments; i += 1) {
        const t = i / segments
        contour.push([pointOnCubic(from[0], command.x1!, command.x2!, command.x!, t), pointOnCubic(from[1], command.y1!, command.y2!, command.y!, t)])
      }
      current = [command.x!, command.y!]
    } else if (command.type === 'Z') {
      contour.push(start)
      if (contour.length) contours.push(contour)
      contour = []
    }
  }
  if (contour.length) contours.push(contour)
  return contours
}

function polylineDxf(points: Array<[number, number]>, layer: string, heightMm: number, closed = false, widthMm = 0): string {
  const constantWidth = widthMm > 0 ? `43\n${widthMm.toFixed(4)}\n` : ''
  const header = `0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}\n${constantWidth}`
  return header + points.map(([x, y]) => `10\n${x.toFixed(4)}\n20\n${(heightMm - y).toFixed(4)}\n`).join('')
}

export function createDxf(config: GeneratorConfig, font: opentype.Font): string {
  const heightMm = circumferenceMm(config.ringDiameterMm)
  const fontSize = config.fontSizeMm
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const entities: string[] = []
  entities.push(polylineDxf([[0, 0], [config.ringWidthMm, 0], [config.ringWidthMm, heightMm], [0, heightMm]], 'FRAME', heightMm, true, frameWidthMm))
  for (const mark of buildScaleMarks(config)) {
    const y = mark.angleDeg === 0 ? config.infinityMarginMm : Math.min(heightMm - 0.5, Math.max(0.5, heightMm * presentationAngle(mark.angleDeg) / 360))
    const tickLength = Math.min(config.ringWidthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    entities.push(polylineDxf([[0, y], [tickLength, y]], 'TICKS', heightMm, false, config.tickWidthMm))
    const path = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize, config.letterSpacingMm)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const path = makeTextPath(font, `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm`, 0.65, infoY + fontSize, fontSize * 0.82, config.letterSpacingMm)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

export function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, '_')
  return cleaned || 'focusing-ring'
}
