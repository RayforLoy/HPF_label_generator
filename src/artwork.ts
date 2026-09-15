import type opentype from 'opentype.js'
import { apertureStops, buildScaleMarks, circleOfConfusionMm, circumferenceMm, depthOfFieldAngleDeg, formatFNumber, generatedMaxAngle, layoutStepDeg } from './core'
import type { GeneratorConfig, ScaleMark } from './types'

type PathCommand = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }

export interface Artwork {
  widthMm: number
  heightMm: number
  marks: ScaleMark[]
  svg: string
}

const xml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export function markPositionMm(index: number, config: GeneratorConfig): number {
  const regularGapMm = circumferenceMm(config.ringDiameterMm) * layoutStepDeg(config) / 360
  const forward = config.infinityMarginMm + index * regularGapMm
  return config.scaleDirection === 'counterclockwise' ? forward : circumferenceMm(config.ringDiameterMm) - forward
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

  for (const [index, mark] of marks.entries()) {
    const baseY = markPositionMm(index, config)
    const y = Math.min(heightMm - frameWidthMm / 2 - 0.1, Math.max(frameWidthMm / 2 + 0.1, baseY))
    const tickLength = Math.min(widthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    nodes.push(`<line x1="0" y1="${y}" x2="${tickLength}" y2="${y}" stroke="${xml(config.tickColor)}" stroke-width="${config.tickWidthMm}"/>`)
    const labelPath = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize, config.letterSpacingMm)
    nodes.push(`<path d="${labelPath.toPathData(3)}" fill="${xml(config.textColor)}"/>`)
  }

  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const label = `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm · DIST. ${config.distanceUnit.toUpperCase()}`
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
  for (const [index, mark] of buildScaleMarks(config).entries()) {
    const y = Math.min(heightMm - 0.5, Math.max(0.5, markPositionMm(index, config)))
    const tickLength = Math.min(config.ringWidthMm * 0.42, config.tickLengthMm * (mark.major ? 1.35 : 1))
    entities.push(polylineDxf([[0, y], [tickLength, y]], 'TICKS', heightMm, false, config.tickWidthMm))
    const path = makeTextPath(font, mark.label, tickLength + 0.42, y + fontSize * 0.34, fontSize, config.letterSpacingMm)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  if (config.showFocalLength) {
    const infoY = Math.min(heightMm - fontSize * 2.2, heightMm * (config.maxAngleDeg + 32) / 360)
    const path = makeTextPath(font, `E.F.L. ${Number(config.focalLengthMm.toFixed(2))} mm · DIST. ${config.distanceUnit.toUpperCase()}`, 0.65, infoY + fontSize, fontSize * 0.82, config.letterSpacingMm)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', heightMm, true)))
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

export function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, '_')
  return cleaned || 'focusing-ring'
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): [number, number] {
  const radians = (angleDeg - 90) * Math.PI / 180
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)]
}

const directedAngle = (config: Pick<GeneratorConfig, 'scaleDirection'>, angleDeg: number) => config.scaleDirection === 'clockwise' ? angleDeg : -angleDeg

function svgLineAtAngle(cx: number, cy: number, innerRadius: number, outerRadius: number, angleDeg: number, color: string, width: number, extra = ''): string {
  const start = polar(cx, cy, innerRadius, angleDeg)
  const end = polar(cx, cy, outerRadius, angleDeg)
  return `<line x1="${start[0].toFixed(4)}" y1="${start[1].toFixed(4)}" x2="${end[0].toFixed(4)}" y2="${end[1].toFixed(4)}" stroke="${color}" stroke-width="${width}" ${extra}/>`
}

function donutPath(cx: number, cy: number, outerRadius: number, innerRadius: number): string {
  return `M ${cx - outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 0 ${cx + outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 0 ${cx - outerRadius} ${cy} Z M ${cx - innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx + innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx - innerRadius} ${cy} Z`
}

export function createFrontArtwork(config: GeneratorConfig, includeAlignmentGuide = false): Artwork {
  const stickerDiameter = config.frontOuterDiameterMm
  const guideMargin = includeAlignmentGuide ? Math.max(12, stickerDiameter * 0.12) : 0
  const alignmentDiameter = includeAlignmentGuide ? Math.max(stickerDiameter, config.dofRingDiameterMm + config.ringWidthMm) : stickerDiameter
  const canvasDiameter = alignmentDiameter + guideMargin * 2
  const center = canvasDiameter / 2
  const outerRadius = stickerDiameter / 2
  const innerRadius = config.frontInnerDiameterMm / 2
  const ringWidth = outerRadius - innerRadius
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const frameColor = config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor)
  const marks = buildScaleMarks(config)
  const maxGenerated = generatedMaxAngle(config)
  const minorStep = Math.min(...config.scaleSegments.map((segment) => segment.stepDeg))
  const nodes: string[] = []

  if (!config.transparentBackground) nodes.push(`<path d="${donutPath(center, center, outerRadius, innerRadius)}" fill="${xml(config.backgroundColor)}" fill-rule="evenodd"/>`)
  if (frameWidthMm > 0) {
    nodes.push(`<circle cx="${center}" cy="${center}" r="${outerRadius - frameWidthMm / 2}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
    nodes.push(`<circle cx="${center}" cy="${center}" r="${innerRadius + frameWidthMm / 2}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
  }

  for (let angle = 0; angle <= maxGenerated + 1e-8; angle += minorStep) {
    nodes.push(svgLineAtAngle(center, center, innerRadius + frameWidthMm, innerRadius + Math.max(ringWidth * 0.2, 1), directedAngle(config, angle), xml(config.tickColor), Math.max(config.tickWidthMm * 0.45, 0.12)))
  }
  for (let angle = 0; angle <= maxGenerated + 1e-8; angle += layoutStepDeg(config)) {
    const inner = innerRadius + frameWidthMm
    const outer = outerRadius - frameWidthMm
    nodes.push(svgLineAtAngle(center, center, inner + ringWidth * 0.25, outer, directedAngle(config, angle), xml(config.tickColor), config.tickWidthMm))
  }

  if (includeAlignmentGuide) {
    const guideInner = outerRadius + 2.5
    const guideOuter = outerRadius + 5.2
    const guideColor = '#2ee8ff'
    for (let angle = 0; angle <= config.maxAngleDeg + 1e-8; angle += minorStep) {
      const major = Math.abs(angle % Math.max(layoutStepDeg(config), minorStep)) < 1e-7
      nodes.push(svgLineAtAngle(center, center, guideInner, major ? guideOuter : guideInner + 1.1, directedAngle(config, angle), guideColor, major ? 0.32 : 0.16, 'opacity="0.82"'))
    }
    for (const percent of [0, 25, 50, 75, 100]) {
      const angle = config.maxAngleDeg * percent / 100
      const [x, y] = polar(center, center, outerRadius + 8.4, directedAngle(config, angle))
      nodes.push(`<text x="${x.toFixed(3)}" y="${(y + 1.1).toFixed(3)}" fill="${guideColor}" font-size="3" text-anchor="middle" font-family="ui-monospace,monospace">${percent}%</text>`)
    }
    const [usedX, usedY] = polar(center, center, outerRadius + 5.2, directedAngle(config, maxGenerated))
    nodes.push(`<circle cx="${usedX.toFixed(3)}" cy="${usedY.toFixed(3)}" r="1" fill="#7af7bd"/>`)

    const dofColor = '#ffb86c'
    const dofRadius = config.dofRingDiameterMm / 2
    const dofHalfWidth = Math.min(config.ringWidthMm * 0.28, 2.2)
    nodes.push(`<circle cx="${center}" cy="${center}" r="${dofRadius}" fill="none" stroke="${dofColor}" stroke-width="0.22" stroke-dasharray="1.2 1.2" opacity="0.72"/>`)
    const cocMm = circleOfConfusionMm(config)
    for (const fNumber of apertureStops(config)) {
      const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
      for (const angle of [maxGenerated - offset, maxGenerated + offset]) {
        nodes.push(svgLineAtAngle(center, center, dofRadius - dofHalfWidth, dofRadius + dofHalfWidth, directedAngle(config, angle), dofColor, 0.32))
      }
    }
    const [legendX, legendY] = polar(center, center, dofRadius + dofHalfWidth + 4.3, directedAngle(config, maxGenerated))
    nodes.push(`<text x="${legendX.toFixed(3)}" y="${(legendY + 1).toFixed(3)}" fill="${dofColor}" font-size="2.6" text-anchor="middle" font-family="ui-monospace,monospace">DOF Ø${config.dofRingDiameterMm}</text>`)
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasDiameter}mm" height="${canvasDiameter}mm" viewBox="0 0 ${canvasDiameter} ${canvasDiameter}" role="img" aria-label="${xml(config.lensName)} front focusing scale">${nodes.join('')}</svg>`
  return { widthMm: stickerDiameter, heightMm: stickerDiameter, marks, svg }
}

function dxfLineAtAngle(cx: number, cy: number, innerRadius: number, outerRadius: number, angleDeg: number, widthMm: number, layer: string): string {
  const start = polar(cx, cy, innerRadius, angleDeg)
  const end = polar(cx, cy, outerRadius, angleDeg)
  return `0\nLWPOLYLINE\n8\n${layer}\n90\n2\n70\n0\n43\n${widthMm.toFixed(4)}\n10\n${start[0].toFixed(4)}\n20\n${(cy * 2 - start[1]).toFixed(4)}\n10\n${end[0].toFixed(4)}\n20\n${(cy * 2 - end[1]).toFixed(4)}\n`
}

export function createFrontDxf(config: GeneratorConfig): string {
  const diameter = config.frontOuterDiameterMm
  const center = diameter / 2
  const outerRadius = diameter / 2
  const innerRadius = config.frontInnerDiameterMm / 2
  const ringWidth = outerRadius - innerRadius
  const minorStep = Math.min(...config.scaleSegments.map((segment) => segment.stepDeg))
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const entities: string[] = [
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${outerRadius}\n`,
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${innerRadius}\n`,
  ]
  for (let angle = 0; angle <= generatedMaxAngle(config) + 1e-8; angle += minorStep) {
    entities.push(dxfLineAtAngle(center, center, innerRadius + frameWidthMm, innerRadius + Math.max(ringWidth * 0.2, 1), directedAngle(config, angle), Math.max(config.tickWidthMm * 0.45, 0.12), 'ANGLE_TICKS'))
  }
  for (let angle = 0; angle <= generatedMaxAngle(config) + 1e-8; angle += layoutStepDeg(config)) {
    entities.push(dxfLineAtAngle(center, center, innerRadius + frameWidthMm + ringWidth * 0.25, outerRadius - frameWidthMm, directedAngle(config, angle), config.tickWidthMm, 'DISTANCE_TICKS'))
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

function dofArcPoints(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, segments = 18): Array<[number, number]> {
  return Array.from({ length: segments + 1 }, (_, index) => polar(cx, cy, radius, startAngle + (endAngle - startAngle) * index / segments))
}

export function createDofArtwork(config: GeneratorConfig, font: opentype.Font): Artwork {
  const outerRadius = (config.dofRingDiameterMm + config.ringWidthMm) / 2
  const innerRadius = (config.dofRingDiameterMm - config.ringWidthMm) / 2
  const diameter = outerRadius * 2
  const center = outerRadius
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const frameColor = config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor)
  const stops = apertureStops(config)
  const cocMm = circleOfConfusionMm(config)
  const nodes: string[] = []

  if (!config.transparentBackground) nodes.push(`<path d="${donutPath(center, center, outerRadius, innerRadius)}" fill="${xml(config.backgroundColor)}" fill-rule="evenodd"/>`)
  if (frameWidthMm > 0) {
    nodes.push(`<circle cx="${center}" cy="${center}" r="${outerRadius - frameWidthMm / 2}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
    nodes.push(`<circle cx="${center}" cy="${center}" r="${innerRadius + frameWidthMm / 2}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
  }
  nodes.push(svgLineAtAngle(center, center, innerRadius + frameWidthMm, outerRadius - frameWidthMm, 0, xml(config.tickColor), config.tickWidthMm * 1.15))

  stops.forEach((fNumber, index) => {
    const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
    const levelRadius = innerRadius + config.ringWidthMm * (0.25 + 0.48 * index / Math.max(1, stops.length - 1))
    const leftAngle = directedAngle(config, -offset)
    const rightAngle = directedAngle(config, offset)
    const leftOuter = polar(center, center, outerRadius - frameWidthMm, leftAngle)
    const leftInner = polar(center, center, levelRadius, leftAngle)
    const rightInner = polar(center, center, levelRadius, rightAngle)
    const rightOuter = polar(center, center, outerRadius - frameWidthMm, rightAngle)
    const sweep = config.scaleDirection === 'clockwise' ? 1 : 0
    nodes.push(`<path d="M ${leftOuter[0].toFixed(4)} ${leftOuter[1].toFixed(4)} L ${leftInner[0].toFixed(4)} ${leftInner[1].toFixed(4)} A ${levelRadius.toFixed(4)} ${levelRadius.toFixed(4)} 0 0 ${sweep} ${rightInner[0].toFixed(4)} ${rightInner[1].toFixed(4)} L ${rightOuter[0].toFixed(4)} ${rightOuter[1].toFixed(4)}" fill="none" stroke="${xml(config.tickColor)}" stroke-width="${config.tickWidthMm}"/>`)
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    const path = makeTextPath(font, label, center - labelWidth / 2, center - levelRadius + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
    nodes.push(`<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`)
  })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}mm" height="${diameter}mm" viewBox="0 0 ${diameter} ${diameter}" role="img" aria-label="${xml(config.lensName)} depth of field scale">${nodes.join('')}</svg>`
  return { widthMm: diameter, heightMm: diameter, marks: [], svg }
}

export function createDofDxf(config: GeneratorConfig, font: opentype.Font): string {
  const outerRadius = (config.dofRingDiameterMm + config.ringWidthMm) / 2
  const innerRadius = (config.dofRingDiameterMm - config.ringWidthMm) / 2
  const diameter = outerRadius * 2
  const center = outerRadius
  const stops = apertureStops(config)
  const cocMm = circleOfConfusionMm(config)
  const entities: string[] = [
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${outerRadius}\n`,
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${innerRadius}\n`,
    dxfLineAtAngle(center, center, innerRadius, outerRadius, 0, config.tickWidthMm * 1.15, 'INDEX'),
  ]
  stops.forEach((fNumber, index) => {
    const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
    const levelRadius = innerRadius + config.ringWidthMm * (0.25 + 0.48 * index / Math.max(1, stops.length - 1))
    const leftAngle = directedAngle(config, -offset)
    const rightAngle = directedAngle(config, offset)
    const points = [polar(center, center, outerRadius, leftAngle), ...dofArcPoints(center, center, levelRadius, leftAngle, rightAngle), polar(center, center, outerRadius, rightAngle)]
    entities.push(polylineDxf(points, 'DOF_MARKS', diameter, false, config.tickWidthMm))
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    const path = makeTextPath(font, label, center - labelWidth / 2, center - levelRadius + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
    flatten(path.commands as PathCommand[]).forEach((contour) => entities.push(polylineDxf(contour, 'TEXT_OUTLINES', diameter, true)))
  })
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}
