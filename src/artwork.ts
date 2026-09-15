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

function makeTextPath(font: opentype.Font, text: string, x: number, baseline: number, size: number): opentype.Path {
  return font.getPath(text, x, baseline, size, { kerning: true })
}

export function createArtwork(config: GeneratorConfig, font: opentype.Font, horizontal = false): Artwork {
  const widthMm = config.ringWidthMm
  const heightMm = circumferenceMm(config.ringDiameterMm)
  const marks = buildScaleMarks(config)
  const fontSize = Math.min(2.65, widthMm * 0.29)
  const lineGap = Math.max(config.tickWidthMm, 0.16)
  const nodes: string[] = []

  if (!config.transparentBackground) {
    nodes.push(`<rect width="${widthMm}" height="${heightMm}" fill="${xml(config.backgroundColor)}"/>`)
  } else {
    nodes.push(`<rect x="${lineGap / 2}" y="${lineGap / 2}" width="${widthMm - lineGap}" height="${heightMm - lineGap}" fill="none" stroke="#000000" stroke-width="${lineGap}"/>`)
  }

  for (const mark of marks) {
    const y = Math.min(heightMm - 0.5, Math.max(0.5, heightMm * presentationAngle(mark.angleDeg) / 360))
    const tickLength = Math.min(widthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    nodes.push(`<line x1="0" y1="${y}" x2="${tickLength}" y2="${y}" stroke="${xml(config.tickColor)}" stroke-width="${config.tickWidthMm}"/>`)
    const labelPath = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize)
    nodes.push(`<path d="${labelPath.toPathData(3)}" fill="${xml(config.textColor)}"/>`)
  }

  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const label = `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm`
    const path = makeTextPath(font, label, 0.65, infoY + fontSize, fontSize * 0.82)
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

function polylineDxf(points: Array<[number, number]>, layer: string, heightMm: number, closed = false): string {
  const header = `0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}\n`
  return header + points.map(([x, y]) => `10\n${x.toFixed(4)}\n20\n${(heightMm - y).toFixed(4)}\n`).join('')
}

export function createDxf(config: GeneratorConfig, font: opentype.Font): string {
  const heightMm = circumferenceMm(config.ringDiameterMm)
  const fontSize = Math.min(2.65, config.ringWidthMm * 0.29)
  const entities: string[] = []
  entities.push(polylineDxf([[0, 0], [config.ringWidthMm, 0], [config.ringWidthMm, heightMm], [0, heightMm]], 'FRAME', heightMm, true))
  for (const mark of buildScaleMarks(config)) {
    const y = Math.min(heightMm - 0.5, Math.max(0.5, heightMm * presentationAngle(mark.angleDeg) / 360))
    const tickLength = Math.min(config.ringWidthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    entities.push(polylineDxf([[0, y], [tickLength, y]], 'TICKS', heightMm))
    const path = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const path = makeTextPath(font, `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm`, 0.65, infoY + fontSize, fontSize * 0.82)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

export function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, '_')
  return cleaned || 'focusing-ring'
}
