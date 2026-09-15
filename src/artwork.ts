import type opentype from 'opentype.js'
import { apertureStops, buildScaleMarks, circleOfConfusionMm, circumferenceMm, depthOfFieldAngleDeg, formatFNumber, generatedMaxAngle, layoutAngleForMark, layoutStepDeg } from './core'
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

function svgLineBetween(start: [number, number], end: [number, number], color: string, width: number): string {
  return `<line x1="${start[0].toFixed(4)}" y1="${start[1].toFixed(4)}" x2="${end[0].toFixed(4)}" y2="${end[1].toFixed(4)}" stroke="${color}" stroke-width="${width}"/>`
}

function donutPath(cx: number, cy: number, outerRadius: number, innerRadius: number): string {
  return `M ${cx - outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 0 ${cx + outerRadius} ${cy} A ${outerRadius} ${outerRadius} 0 1 0 ${cx - outerRadius} ${cy} Z M ${cx - innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx + innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx - innerRadius} ${cy} Z`
}

function stripPosition(angleDeg: number, originMm: number, widthMm: number, diameterMm: number, direction: GeneratorConfig['scaleDirection']): number {
  const forward = originMm + circumferenceMm(diameterMm) * angleDeg / 360
  return direction === 'counterclockwise' ? forward : widthMm - forward
}

function rectDxf(widthMm: number, heightMm: number, layer = 'FRAME'): string {
  return polylineDxf([[0, 0], [widthMm, 0], [widthMm, heightMm], [0, heightMm]], layer, heightMm, true)
}

function createFrontStripArtwork(config: GeneratorConfig, includeAlignmentGuide: boolean): Artwork {
  const widthMm = circumferenceMm(config.frontBarrelDiameterMm)
  const heightMm = config.ringWidthMm
  const guideMargin = includeAlignmentGuide ? 9 : 0
  const canvasHeight = heightMm + guideMargin * 2
  const yOffset = guideMargin
  const marks = buildScaleMarks(config)
  const layoutAngles = marks.map((_, index) => layoutAngleForMark(index, config))
  const minAngle = Math.min(0, ...layoutAngles)
  const origin = config.infinityMarginMm - minAngle * circumferenceMm(config.frontBarrelDiameterMm) / 360
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const frameColor = config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor)
  const minorStep = Math.min(...config.scaleSegments.map((segment) => segment.stepDeg))
  const innerY = yOffset + heightMm - frameWidthMm
  const innerEndY = Math.max(yOffset, innerY - config.frontInnerTickLengthMm)
  const outerY = yOffset + frameWidthMm
  const outerEndY = Math.min(yOffset + heightMm, outerY + config.frontOuterTickLengthMm)
  const nodes: string[] = []
  if (!config.transparentBackground) nodes.push(`<rect y="${yOffset}" width="${widthMm}" height="${heightMm}" fill="${xml(config.backgroundColor)}"/>`)
  if (frameWidthMm > 0) nodes.push(`<rect x="${frameWidthMm / 2}" y="${yOffset + frameWidthMm / 2}" width="${widthMm - frameWidthMm}" height="${heightMm - frameWidthMm}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
  marks.forEach((mark, index) => {
    const innerX = stripPosition(mark.angleDeg, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
    const outerX = stripPosition(layoutAngles[index], origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
    nodes.push(svgLineBetween([innerX, innerEndY], [outerX, outerEndY], xml(config.tickColor), config.frontConnectorWidthMm))
    nodes.push(svgLineBetween([outerX, outerY], [outerX, outerEndY], xml(config.tickColor), config.frontOuterTickWidthMm))
  })
  for (let angle = 0; angle <= generatedMaxAngle(config) + 1e-8; angle += minorStep) {
    const x = stripPosition(angle, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
    nodes.push(svgLineBetween([x, innerY], [x, innerEndY], xml(config.tickColor), config.frontInnerTickWidthMm))
  }
  if (includeAlignmentGuide) {
    const guideColor = '#2ee8ff'
    const baseline = yOffset + heightMm + 2.2
    for (let angle = 0; angle <= config.maxAngleDeg + 1e-8; angle += minorStep) {
      const major = Math.abs(angle % Math.max(layoutStepDeg(config), minorStep)) < 1e-7
      const x = stripPosition(angle, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
      nodes.push(svgLineBetween([x, baseline], [x, baseline + (major ? 2.2 : 1.1)], guideColor, major ? 0.3 : 0.16))
    }
    for (const percent of [0, 25, 50, 75, 100]) {
      const x = stripPosition(config.maxAngleDeg * percent / 100, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
      nodes.push(`<text x="${x.toFixed(3)}" y="${(baseline + 5.3).toFixed(3)}" fill="${guideColor}" font-size="2.5" text-anchor="middle" font-family="ui-monospace,monospace">${percent}%</text>`)
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${canvasHeight}mm" viewBox="0 0 ${widthMm} ${canvasHeight}" role="img" aria-label="${xml(config.lensName)} side focusing scale">${nodes.join('')}</svg>`
  return { widthMm, heightMm, marks, svg }
}

export function createFrontArtwork(config: GeneratorConfig, includeAlignmentGuide = false): Artwork {
  if (config.frontShape === 'strip') return createFrontStripArtwork(config, includeAlignmentGuide)
  const stickerDiameter = config.frontOuterDiameterMm
  const guideMargin = includeAlignmentGuide ? Math.max(12, stickerDiameter * 0.12) : 0
  const dofPreviewDiameter = config.dofShape === 'annular' ? config.dofOuterDiameterMm : stickerDiameter
  const alignmentDiameter = includeAlignmentGuide ? Math.max(stickerDiameter, dofPreviewDiameter) : stickerDiameter
  const canvasDiameter = alignmentDiameter + guideMargin * 2
  const center = canvasDiameter / 2
  const outerRadius = stickerDiameter / 2
  const innerRadius = config.frontInnerDiameterMm / 2
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

  const innerRayStart = innerRadius + frameWidthMm
  const innerRayEnd = Math.min(outerRadius, innerRayStart + config.frontInnerTickLengthMm)
  const outerRayEnd = outerRadius - frameWidthMm
  const outerRayStart = Math.max(innerRadius, outerRayEnd - config.frontOuterTickLengthMm)
  for (const [index, mark] of marks.entries()) {
    const innerPoint = polar(center, center, innerRayEnd, directedAngle(config, mark.angleDeg))
    const outerPoint = polar(center, center, outerRayStart, directedAngle(config, layoutAngleForMark(index, config)))
    nodes.push(svgLineBetween(innerPoint, outerPoint, xml(config.tickColor), config.frontConnectorWidthMm))
  }
  for (let angle = 0; angle <= maxGenerated + 1e-8; angle += minorStep) {
    nodes.push(svgLineAtAngle(center, center, innerRayStart, innerRayEnd, directedAngle(config, angle), xml(config.tickColor), config.frontInnerTickWidthMm))
  }
  for (const [index] of marks.entries()) {
    nodes.push(svgLineAtAngle(center, center, outerRayStart, outerRayEnd, directedAngle(config, layoutAngleForMark(index, config)), xml(config.tickColor), config.frontOuterTickWidthMm))
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

    if (config.dofShape === 'annular') {
      const dofColor = '#ffb86c'
      const dofRadius = (config.dofInnerDiameterMm + config.dofOuterDiameterMm) / 4
      const dofHalfWidth = Math.min((config.dofOuterDiameterMm - config.dofInnerDiameterMm) * 0.14, 2.2)
      nodes.push(`<circle cx="${center}" cy="${center}" r="${dofRadius}" fill="none" stroke="${dofColor}" stroke-width="0.22" stroke-dasharray="1.2 1.2" opacity="0.72"/>`)
      const cocMm = circleOfConfusionMm(config)
      for (const fNumber of apertureStops(config)) {
        const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
        for (const angle of [maxGenerated - offset, maxGenerated + offset]) {
          nodes.push(svgLineAtAngle(center, center, dofRadius - dofHalfWidth, dofRadius + dofHalfWidth, directedAngle(config, angle), dofColor, 0.32))
        }
      }
      const [legendX, legendY] = polar(center, center, dofRadius + dofHalfWidth + 4.3, directedAngle(config, maxGenerated))
      nodes.push(`<text x="${legendX.toFixed(3)}" y="${(legendY + 1).toFixed(3)}" fill="${dofColor}" font-size="2.6" text-anchor="middle" font-family="ui-monospace,monospace">DOF Ø${config.dofInnerDiameterMm}–${config.dofOuterDiameterMm}</text>`)
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasDiameter}mm" height="${canvasDiameter}mm" viewBox="0 0 ${canvasDiameter} ${canvasDiameter}" role="img" aria-label="${xml(config.lensName)} front focusing scale">${nodes.join('')}</svg>`
  return { widthMm: stickerDiameter, heightMm: stickerDiameter, marks, svg }
}

function dxfLineAtAngle(cx: number, cy: number, innerRadius: number, outerRadius: number, angleDeg: number, widthMm: number, layer: string): string {
  const start = polar(cx, cy, innerRadius, angleDeg)
  const end = polar(cx, cy, outerRadius, angleDeg)
  return `0\nLWPOLYLINE\n8\n${layer}\n90\n2\n70\n0\n43\n${widthMm.toFixed(4)}\n10\n${start[0].toFixed(4)}\n20\n${(cy * 2 - start[1]).toFixed(4)}\n10\n${end[0].toFixed(4)}\n20\n${(cy * 2 - end[1]).toFixed(4)}\n`
}

function dxfLineBetween(start: [number, number], end: [number, number], heightMm: number, widthMm: number, layer: string): string {
  return `0\nLWPOLYLINE\n8\n${layer}\n90\n2\n70\n0\n43\n${widthMm.toFixed(4)}\n10\n${start[0].toFixed(4)}\n20\n${(heightMm - start[1]).toFixed(4)}\n10\n${end[0].toFixed(4)}\n20\n${(heightMm - end[1]).toFixed(4)}\n`
}

export function createFrontDxf(config: GeneratorConfig): string {
  if (config.frontShape === 'strip') {
    const widthMm = circumferenceMm(config.frontBarrelDiameterMm)
    const heightMm = config.ringWidthMm
    const marks = buildScaleMarks(config)
    const layoutAngles = marks.map((_, index) => layoutAngleForMark(index, config))
    const minAngle = Math.min(0, ...layoutAngles)
    const origin = config.infinityMarginMm - minAngle * circumferenceMm(config.frontBarrelDiameterMm) / 360
    const frameWidthMm = config.frameWidthPx * 25.4 / 96
    const innerY = heightMm - frameWidthMm
    const innerEndY = Math.max(0, innerY - config.frontInnerTickLengthMm)
    const outerY = frameWidthMm
    const outerEndY = Math.min(heightMm, outerY + config.frontOuterTickLengthMm)
    const entities = [rectDxf(widthMm, heightMm)]
    marks.forEach((mark, index) => {
      const innerX = stripPosition(mark.angleDeg, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
      const outerX = stripPosition(layoutAngles[index], origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
      entities.push(dxfLineBetween([innerX, innerEndY], [outerX, outerEndY], heightMm, config.frontConnectorWidthMm, 'CONNECTORS'))
      entities.push(dxfLineBetween([outerX, outerY], [outerX, outerEndY], heightMm, config.frontOuterTickWidthMm, 'DISTANCE_TICKS'))
    })
    const minorStep = Math.min(...config.scaleSegments.map((segment) => segment.stepDeg))
    for (let angle = 0; angle <= generatedMaxAngle(config) + 1e-8; angle += minorStep) {
      const x = stripPosition(angle, origin, widthMm, config.frontBarrelDiameterMm, config.scaleDirection)
      entities.push(dxfLineBetween([x, innerY], [x, innerEndY], heightMm, config.frontInnerTickWidthMm, 'ANGLE_TICKS'))
    }
    return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
  }
  const diameter = config.frontOuterDiameterMm
  const center = diameter / 2
  const outerRadius = diameter / 2
  const innerRadius = config.frontInnerDiameterMm / 2
  const minorStep = Math.min(...config.scaleSegments.map((segment) => segment.stepDeg))
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const entities: string[] = [
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${outerRadius}\n`,
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${innerRadius}\n`,
  ]
  const innerRayStart = innerRadius + frameWidthMm
  const innerRayEnd = Math.min(outerRadius, innerRayStart + config.frontInnerTickLengthMm)
  const outerRayEnd = outerRadius - frameWidthMm
  const outerRayStart = Math.max(innerRadius, outerRayEnd - config.frontOuterTickLengthMm)
  for (const [index, mark] of buildScaleMarks(config).entries()) {
    const innerPoint = polar(center, center, innerRayEnd, directedAngle(config, mark.angleDeg))
    const outerPoint = polar(center, center, outerRayStart, directedAngle(config, layoutAngleForMark(index, config)))
    entities.push(dxfLineBetween(innerPoint, outerPoint, diameter, config.frontConnectorWidthMm, 'CONNECTORS'))
  }
  for (let angle = 0; angle <= generatedMaxAngle(config) + 1e-8; angle += minorStep) {
    entities.push(dxfLineAtAngle(center, center, innerRayStart, innerRayEnd, directedAngle(config, angle), config.frontInnerTickWidthMm, 'ANGLE_TICKS'))
  }
  for (const [index] of buildScaleMarks(config).entries()) {
    entities.push(dxfLineAtAngle(center, center, outerRayStart, outerRayEnd, directedAngle(config, layoutAngleForMark(index, config)), config.frontOuterTickWidthMm, 'DISTANCE_TICKS'))
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

function dofArcPoints(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, segments = 18): Array<[number, number]> {
  return Array.from({ length: segments + 1 }, (_, index) => polar(cx, cy, radius, startAngle + (endAngle - startAngle) * index / segments))
}

function rotatePoint(point: [number, number], center: [number, number], angleDeg: number): [number, number] {
  const radians = angleDeg * Math.PI / 180
  const x = point[0] - center[0]
  const y = point[1] - center[1]
  return [center[0] + x * Math.cos(radians) - y * Math.sin(radians), center[1] + x * Math.sin(radians) + y * Math.cos(radians)]
}

export function createDofArtwork(config: GeneratorConfig, font: opentype.Font): Artwork {
  if (config.dofShape === 'strip') return createDofStripArtwork(config, font)
  const outerRadius = config.dofOuterDiameterMm / 2
  const innerRadius = config.dofInnerDiameterMm / 2
  const ringWidth = outerRadius - innerRadius
  const diameter = config.dofOuterDiameterMm
  const center = diameter / 2
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
  nodes.push(svgLineAtAngle(center, center, innerRadius + frameWidthMm, outerRadius - frameWidthMm, 0, xml(config.tickColor), config.dofTickWidthMm * 1.15))

  stops.forEach((fNumber, index) => {
    const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    if (config.dofStyle === 'compact') {
      const tickLength = Math.min(1.8, ringWidth * 0.28)
      const labelRadius = outerRadius - frameWidthMm - tickLength - config.dofFontSizeMm * 0.72
      for (const rawAngle of [-offset, offset]) {
        const angle = directedAngle(config, rawAngle)
        nodes.push(svgLineAtAngle(center, center, outerRadius - frameWidthMm - tickLength, outerRadius - frameWidthMm, angle, xml(config.tickColor), config.dofTickWidthMm))
        if (config.dofShowLabels) {
          const labelCenterY = center - labelRadius
          const path = makeTextPath(font, label, center - labelWidth / 2, labelCenterY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
          const labelNode = `<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`
          const oriented = config.dofTextDirection === 'reverse' ? `<g transform="rotate(180 ${center} ${labelCenterY})">${labelNode}</g>` : labelNode
          nodes.push(`<g transform="rotate(${angle.toFixed(4)} ${center} ${center})">${oriented}</g>`)
        }
      }
    } else {
      const levelRadius = innerRadius + ringWidth * (0.25 + 0.48 * index / Math.max(1, stops.length - 1))
      const leftAngle = directedAngle(config, -offset)
      const rightAngle = directedAngle(config, offset)
      const leftOuter = polar(center, center, outerRadius - frameWidthMm, leftAngle)
      const leftInner = polar(center, center, levelRadius, leftAngle)
      const rightInner = polar(center, center, levelRadius, rightAngle)
      const rightOuter = polar(center, center, outerRadius - frameWidthMm, rightAngle)
      const sweep = config.scaleDirection === 'clockwise' ? 1 : 0
      nodes.push(`<path d="M ${leftOuter[0].toFixed(4)} ${leftOuter[1].toFixed(4)} L ${leftInner[0].toFixed(4)} ${leftInner[1].toFixed(4)} A ${levelRadius.toFixed(4)} ${levelRadius.toFixed(4)} 0 0 ${sweep} ${rightInner[0].toFixed(4)} ${rightInner[1].toFixed(4)} L ${rightOuter[0].toFixed(4)} ${rightOuter[1].toFixed(4)}" fill="none" stroke="${xml(config.tickColor)}" stroke-width="${config.dofTickWidthMm}"/>`)
      if (config.dofShowLabels) {
        const labelCenterY = center - levelRadius
        const path = makeTextPath(font, label, center - labelWidth / 2, labelCenterY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
        const labelNode = `<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`
        nodes.push(config.dofTextDirection === 'reverse' ? `<g transform="rotate(180 ${center} ${labelCenterY})">${labelNode}</g>` : labelNode)
      }
    }
  })

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${diameter}mm" height="${diameter}mm" viewBox="0 0 ${diameter} ${diameter}" role="img" aria-label="${xml(config.lensName)} depth of field scale">${nodes.join('')}</svg>`
  return { widthMm: diameter, heightMm: diameter, marks: [], svg }
}

function createDofStripArtwork(config: GeneratorConfig, font: opentype.Font): Artwork {
  const widthMm = circumferenceMm(config.dofRingDiameterMm)
  const heightMm = config.ringWidthMm
  const centerX = widthMm / 2
  const frameWidthMm = config.frameWidthPx * 25.4 / 96
  const frameColor = config.transparentBackground ? '#000000' : contrastColor(config.backgroundColor)
  const stops = apertureStops(config)
  const cocMm = circleOfConfusionMm(config)
  const nodes: string[] = []
  if (!config.transparentBackground) nodes.push(`<rect width="${widthMm}" height="${heightMm}" fill="${xml(config.backgroundColor)}"/>`)
  if (frameWidthMm > 0) nodes.push(`<rect x="${frameWidthMm / 2}" y="${frameWidthMm / 2}" width="${widthMm - frameWidthMm}" height="${heightMm - frameWidthMm}" fill="none" stroke="${frameColor}" stroke-width="${frameWidthMm}"/>`)
  nodes.push(svgLineBetween([centerX, frameWidthMm], [centerX, heightMm - frameWidthMm], xml(config.tickColor), config.dofTickWidthMm * 1.15))
  stops.forEach((fNumber, index) => {
    const offsetMm = circumferenceMm(config.dofRingDiameterMm) * depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg) / 360
    const xs = [centerX - offsetMm, centerX + offsetMm]
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    if (config.dofStyle === 'compact') {
      const tickLength = Math.min(1.8, heightMm * 0.28)
      const labelCenterY = frameWidthMm + tickLength + config.dofFontSizeMm * 0.72
      xs.forEach((x) => {
        nodes.push(svgLineBetween([x, frameWidthMm], [x, frameWidthMm + tickLength], xml(config.tickColor), config.dofTickWidthMm))
        if (config.dofShowLabels) {
          const path = makeTextPath(font, label, x - labelWidth / 2, labelCenterY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
          const labelNode = `<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`
          nodes.push(config.dofTextDirection === 'reverse' ? `<g transform="rotate(180 ${x} ${labelCenterY})">${labelNode}</g>` : labelNode)
        }
      })
    } else {
      const levelY = heightMm * (0.74 - 0.48 * index / Math.max(1, stops.length - 1))
      nodes.push(`<path d="M ${xs[0].toFixed(4)} ${frameWidthMm.toFixed(4)} L ${xs[0].toFixed(4)} ${levelY.toFixed(4)} L ${xs[1].toFixed(4)} ${levelY.toFixed(4)} L ${xs[1].toFixed(4)} ${frameWidthMm.toFixed(4)}" fill="none" stroke="${xml(config.tickColor)}" stroke-width="${config.dofTickWidthMm}"/>`)
      if (config.dofShowLabels) {
        const path = makeTextPath(font, label, centerX - labelWidth / 2, levelY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
        const labelNode = `<path d="${path.toPathData(3)}" fill="${xml(config.textColor)}"/>`
        nodes.push(config.dofTextDirection === 'reverse' ? `<g transform="rotate(180 ${centerX} ${levelY})">${labelNode}</g>` : labelNode)
      }
    }
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-label="${xml(config.lensName)} side depth of field scale">${nodes.join('')}</svg>`
  return { widthMm, heightMm, marks: [], svg }
}

export function createDofDxf(config: GeneratorConfig, font: opentype.Font): string {
  if (config.dofShape === 'strip') return createDofStripDxf(config, font)
  const outerRadius = config.dofOuterDiameterMm / 2
  const innerRadius = config.dofInnerDiameterMm / 2
  const ringWidth = outerRadius - innerRadius
  const diameter = config.dofOuterDiameterMm
  const center = diameter / 2
  const stops = apertureStops(config)
  const cocMm = circleOfConfusionMm(config)
  const entities: string[] = [
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${outerRadius}\n`,
    `0\nCIRCLE\n8\nFRAME\n10\n${center}\n20\n${center}\n40\n${innerRadius}\n`,
    dxfLineAtAngle(center, center, innerRadius, outerRadius, 0, config.dofTickWidthMm * 1.15, 'INDEX'),
  ]
  stops.forEach((fNumber, index) => {
    const offset = depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg)
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    if (config.dofStyle === 'compact') {
      const tickLength = Math.min(1.8, ringWidth * 0.28)
      const labelRadius = outerRadius - tickLength - config.dofFontSizeMm * 0.72
      for (const rawAngle of [-offset, offset]) {
        const angle = directedAngle(config, rawAngle)
        entities.push(dxfLineAtAngle(center, center, outerRadius - tickLength, outerRadius, angle, config.dofTickWidthMm, 'DOF_MARKS'))
        if (config.dofShowLabels) {
          const labelCenter: [number, number] = [center, center - labelRadius]
          const path = makeTextPath(font, label, center - labelWidth / 2, labelCenter[1] + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
          flatten(path.commands as PathCommand[]).forEach((contour) => {
            const oriented = config.dofTextDirection === 'reverse' ? contour.map((point) => rotatePoint(point, labelCenter, 180)) : contour
            entities.push(polylineDxf(oriented.map((point) => rotatePoint(point, [center, center], angle)), 'TEXT_OUTLINES', diameter, true))
          })
        }
      }
    } else {
      const levelRadius = innerRadius + ringWidth * (0.25 + 0.48 * index / Math.max(1, stops.length - 1))
      const leftAngle = directedAngle(config, -offset)
      const rightAngle = directedAngle(config, offset)
      const points = [polar(center, center, outerRadius, leftAngle), ...dofArcPoints(center, center, levelRadius, leftAngle, rightAngle), polar(center, center, outerRadius, rightAngle)]
      entities.push(polylineDxf(points, 'DOF_MARKS', diameter, false, config.dofTickWidthMm))
      if (config.dofShowLabels) {
        const labelCenter: [number, number] = [center, center - levelRadius]
        const path = makeTextPath(font, label, center - labelWidth / 2, labelCenter[1] + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
        flatten(path.commands as PathCommand[]).forEach((contour) => {
          const oriented = config.dofTextDirection === 'reverse' ? contour.map((point) => rotatePoint(point, labelCenter, 180)) : contour
          entities.push(polylineDxf(oriented, 'TEXT_OUTLINES', diameter, true))
        })
      }
    }
  })
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}

function createDofStripDxf(config: GeneratorConfig, font: opentype.Font): string {
  const widthMm = circumferenceMm(config.dofRingDiameterMm)
  const heightMm = config.ringWidthMm
  const centerX = widthMm / 2
  const stops = apertureStops(config)
  const cocMm = circleOfConfusionMm(config)
  const entities = [rectDxf(widthMm, heightMm), dxfLineBetween([centerX, 0], [centerX, heightMm], heightMm, config.dofTickWidthMm * 1.15, 'INDEX')]
  stops.forEach((fNumber, index) => {
    const offsetMm = circumferenceMm(config.dofRingDiameterMm) * depthOfFieldAngleDeg(fNumber, cocMm, config.extensionMmPerDeg) / 360
    const xs = [centerX - offsetMm, centerX + offsetMm]
    const label = formatFNumber(fNumber)
    const labelWidth = font.getAdvanceWidth(label, config.dofFontSizeMm, { kerning: true })
    if (config.dofStyle === 'compact') {
      const tickLength = Math.min(1.8, heightMm * 0.28)
      const labelCenterY = tickLength + config.dofFontSizeMm * 0.72
      xs.forEach((x) => {
        entities.push(dxfLineBetween([x, 0], [x, tickLength], heightMm, config.dofTickWidthMm, 'DOF_MARKS'))
        if (config.dofShowLabels) {
          const path = makeTextPath(font, label, x - labelWidth / 2, labelCenterY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
          flatten(path.commands as PathCommand[]).forEach((contour) => {
            const oriented = config.dofTextDirection === 'reverse' ? contour.map((point) => rotatePoint(point, [x, labelCenterY], 180)) : contour
            entities.push(polylineDxf(oriented, 'TEXT_OUTLINES', heightMm, true))
          })
        }
      })
    } else {
      const levelY = heightMm * (0.74 - 0.48 * index / Math.max(1, stops.length - 1))
      entities.push(polylineDxf([[xs[0], 0], [xs[0], levelY], [xs[1], levelY], [xs[1], 0]], 'DOF_MARKS', heightMm, false, config.dofTickWidthMm))
      if (config.dofShowLabels) {
        const path = makeTextPath(font, label, centerX - labelWidth / 2, levelY + config.dofFontSizeMm * 0.34, config.dofFontSizeMm, config.letterSpacingMm)
        flatten(path.commands as PathCommand[]).forEach((contour) => {
          const oriented = config.dofTextDirection === 'reverse' ? contour.map((point) => rotatePoint(point, [centerX, levelY], 180)) : contour
          entities.push(polylineDxf(oriented, 'TEXT_OUTLINES', heightMm, true))
        })
      }
    }
  })
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities.join('')}0\nENDSEC\n0\nEOF\n`
}
