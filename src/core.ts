import type { CocMode, GeneratorConfig, Lens, ScaleMark } from './types'

export const DEFAULT_CONFIG: GeneratorConfig = {
  lensName: 'Makro-Symmar 180 HM', focalLengthMm: 179.9, focalSource: 'manual',
  extensionMmPerDeg: 4 / 45, maxAngleDeg: 165,
  scaleSegments: [{ id: 'fine', count: 5, stepDeg: 1 }, { id: 'coarse', count: 32, stepDeg: 5 }],
  layoutSegmentId: 'coarse', scaleDirection: 'counterclockwise', ringDiameterMm: 86.7, ringWidthMm: 9.5,
  frontInnerDiameterMm: 75, frontOuterDiameterMm: 100,
  frontInnerTickLengthMm: 1.5, frontInnerTickWidthMm: 0.25,
  frontOuterTickLengthMm: 3, frontOuterTickWidthMm: 0.5, frontConnectorWidthMm: 0.3,
  cocMode: 'film135', sensorWidthMm: 36, sensorHeightMm: 24, sensorMegapixels: 24,
  maxApertureFNumber: 5.6, dofStops: 5, dofFontSizeMm: 1.25, dofRingDiameterMm: 86.7, dofStyle: 'nested',
  significantDigits: 4, distanceUnit: 'm', dpi: 300, tickLengthMm: 1, tickWidthMm: 0.5,
  fontSizeMm: 2.6, letterSpacingMm: 0, frameWidthPx: 2, infinityMarginMm: 2,
  showFocalLength: true, transparentBackground: false, backgroundColor: '#050505',
  tickColor: '#ffffff', textColor: '#ffffff', fontId: 'square721', fontName: 'Square721 Cn BT Bold',
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i += 1 } else quoted = !quoted
    } else if (char === ',' && !quoted) { values.push(value.trim()); value = '' }
    else value += char
  }
  values.push(value.trim())
  return values
}

const numberOrNull = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseLensCsv(csv: string): Lens[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  const headerIndex = lines.findIndex((line) => splitCsvLine(line)[0] === 'lensName')
  if (headerIndex < 0) throw new Error('lensName header not found')
  const headers = splitCsvLine(lines[headerIndex])
  return lines.slice(headerIndex + 1).map(splitCsvLine).filter((row) => row[0]).map((row) => {
    const raw = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
    return {
      ...raw,
      lensName: raw.lensName,
      vender: raw.vender,
      version: raw.version,
      nominalFocalLength: numberOrNull(raw.nominalFocalLength),
      nominalFNumber: numberOrNull(raw.nominalFNumber),
      efl: numberOrNull(raw.efl),
    }
  }) as Lens[]
}

export function focalLengthFor(lens: Lens): { value: number; source: 'efl' | 'nominal' } | null {
  if (lens.efl && lens.efl > 0) return { value: lens.efl, source: 'efl' }
  if (lens.nominalFocalLength && lens.nominalFocalLength > 0) return { value: lens.nominalFocalLength, source: 'nominal' }
  return null
}

export function formatDistance(valueMetres: number, significantDigits: number, unit: 'm' | 'ft' = 'm'): string {
  const value = unit === 'ft' ? valueMetres * 3.280839895013123 : valueMetres
  if (!Number.isFinite(value)) return 'INF'
  if (value >= 1000) return `${Number((value / 1000).toPrecision(Math.max(2, significantDigits - 1)))}k`
  if (value >= 1) return Number(value.toPrecision(significantDigits)).toString()
  return Number(value.toPrecision(significantDigits)).toString()
}

export function distanceAtAngle(focalLengthMm: number, extensionMmPerDeg: number, angleDeg: number): number {
  if (angleDeg === 0) return Number.POSITIVE_INFINITY
  const imageDistanceMm = focalLengthMm + extensionMmPerDeg * angleDeg
  const objectDistanceMm = 1 / (1 / focalLengthMm - 1 / imageDistanceMm)
  return (objectDistanceMm + imageDistanceMm) / 1000
}

export function buildScaleMarks(config: GeneratorConfig): ScaleMark[] {
  const angles = buildScaleAngles(config)
  return angles.map((angleDeg) => {
    const distanceM = distanceAtAngle(config.focalLengthMm, config.extensionMmPerDeg, angleDeg)
    return { angleDeg, distanceM, label: formatDistance(distanceM, config.significantDigits, config.distanceUnit), major: angleDeg === 0 || angleDeg % 10 === 0 }
  })
}

export function buildScaleAngles(config: Pick<GeneratorConfig, 'scaleSegments'>): number[] {
  const angles = [0]
  let angle = 0
  for (const segment of config.scaleSegments) {
    for (let index = 0; index < segment.count; index += 1) {
      angle += segment.stepDeg
      angles.push(angle)
    }
  }
  return angles
}

export function generatedMaxAngle(config: Pick<GeneratorConfig, 'scaleSegments'>): number {
  return config.scaleSegments.reduce((total, segment) => total + segment.count * segment.stepDeg, 0)
}

export function layoutStepDeg(config: Pick<GeneratorConfig, 'scaleSegments' | 'layoutSegmentId'>): number {
  return config.scaleSegments.find((segment) => segment.id === config.layoutSegmentId)?.stepDeg ?? config.scaleSegments[0]?.stepDeg ?? 5
}

export function layoutAngleForMark(index: number, config: Pick<GeneratorConfig, 'scaleSegments' | 'layoutSegmentId'>): number {
  const selectedIndex = Math.max(0, config.scaleSegments.findIndex((segment) => segment.id === config.layoutSegmentId))
  const before = config.scaleSegments.slice(0, selectedIndex)
  const anchorIndex = before.reduce((total, segment) => total + segment.count, 0)
  const anchorAngle = before.reduce((total, segment) => total + segment.count * segment.stepDeg, 0)
  return anchorAngle + (index - anchorIndex) * layoutStepDeg(config)
}

export const COC_PRESETS: Record<Exclude<CocMode, 'customSensor'>, number> = {
  film135: Math.hypot(36, 24) / 1500,
  kodak35: 0.0254,
  fullFrame24mp: Math.sqrt(36 * 24 / 24_000_000),
}

export function circleOfConfusionMm(config: Pick<GeneratorConfig, 'cocMode' | 'sensorWidthMm' | 'sensorHeightMm' | 'sensorMegapixels'>): number {
  if (config.cocMode !== 'customSensor') return COC_PRESETS[config.cocMode]
  if (!(config.sensorWidthMm > 0 && config.sensorHeightMm > 0 && config.sensorMegapixels > 0)) return Number.NaN
  return Math.sqrt(config.sensorWidthMm * config.sensorHeightMm / (config.sensorMegapixels * 1_000_000))
}

export function apertureStops(config: Pick<GeneratorConfig, 'maxApertureFNumber' | 'dofStops'>): number[] {
  const stopCount = Number.isInteger(config.dofStops) && config.dofStops > 0 ? Math.min(config.dofStops, 10) : 0
  return Array.from({ length: stopCount + 1 }, (_, stop) => config.maxApertureFNumber * 2 ** (stop / 2))
}

export function depthOfFieldAngleDeg(fNumber: number, cocMm: number, extensionMmPerDeg: number): number {
  return fNumber * cocMm / extensionMmPerDeg
}

export function formatFNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const conventional = [0.7, 1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32, 45, 64, 90, 128]
  const closest = conventional.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best)
  return Math.abs(closest - value) / value < 0.035 ? String(closest) : Number(value.toPrecision(3)).toString()
}

export const circumferenceMm = (diameterMm: number) => Math.PI * diameterMm

export function validateConfig(config: GeneratorConfig): string[] {
  const errors: string[] = []
  if (!(config.focalLengthMm > 0)) errors.push('focalLengthMm')
  if (!(config.extensionMmPerDeg > 0)) errors.push('extensionMmPerDeg')
  if (!(config.maxAngleDeg >= 5 && config.maxAngleDeg <= 355)) errors.push('maxAngleDeg')
  if (!config.scaleSegments.length || config.scaleSegments.some((segment) => !Number.isInteger(segment.count) || segment.count < 1 || segment.count > 360 || !(segment.stepDeg > 0 && segment.stepDeg <= 90))) errors.push('scaleSegments')
  if (generatedMaxAngle(config) > 360) errors.push('scaleSegments')
  if (!config.scaleSegments.some((segment) => segment.id === config.layoutSegmentId)) errors.push('layoutSegmentId')
  const unfoldedSpanMm = config.scaleSegments.reduce((total, segment) => total + segment.count, 0) * circumferenceMm(config.ringDiameterMm) * layoutStepDeg(config) / 360
  if (unfoldedSpanMm + config.infinityMarginMm >= circumferenceMm(config.ringDiameterMm)) errors.push('layoutSegmentId')
  if (!(config.ringDiameterMm > 0)) errors.push('ringDiameterMm')
  if (!(config.ringWidthMm > 0)) errors.push('ringWidthMm')
  if (!(config.frontInnerDiameterMm > 0)) errors.push('frontInnerDiameterMm')
  if (!(config.frontOuterDiameterMm > config.frontInnerDiameterMm)) errors.push('frontOuterDiameterMm')
  const frontBandWidth = (config.frontOuterDiameterMm - config.frontInnerDiameterMm) / 2
  if (!(config.frontInnerTickLengthMm > 0 && config.frontInnerTickLengthMm < frontBandWidth)) errors.push('frontInnerTickLengthMm')
  if (!(config.frontInnerTickWidthMm > 0 && config.frontInnerTickWidthMm <= 3)) errors.push('frontInnerTickWidthMm')
  if (!(config.frontOuterTickLengthMm > 0 && config.frontOuterTickLengthMm < frontBandWidth)) errors.push('frontOuterTickLengthMm')
  if (!(config.frontOuterTickWidthMm > 0 && config.frontOuterTickWidthMm <= 3)) errors.push('frontOuterTickWidthMm')
  if (!(config.frontConnectorWidthMm > 0 && config.frontConnectorWidthMm <= 3)) errors.push('frontConnectorWidthMm')
  if (!(config.sensorWidthMm > 0)) errors.push('sensorWidthMm')
  if (!(config.sensorHeightMm > 0)) errors.push('sensorHeightMm')
  if (!(config.sensorMegapixels > 0)) errors.push('sensorMegapixels')
  const cocMm = circleOfConfusionMm(config)
  if (!(Number.isFinite(cocMm) && cocMm > 0)) errors.push('cocMode')
  if (!(config.maxApertureFNumber > 0 && config.maxApertureFNumber <= 128)) errors.push('maxApertureFNumber')
  if (!Number.isInteger(config.dofStops) || config.dofStops < 1 || config.dofStops > 10) errors.push('dofStops')
  const widestDofAngle = depthOfFieldAngleDeg(apertureStops(config).at(-1) ?? config.maxApertureFNumber, cocMm, config.extensionMmPerDeg)
  if (!(Number.isFinite(widestDofAngle) && widestDofAngle < 90)) errors.push('dofStops')
  if (!(config.dofFontSizeMm > 0 && config.dofFontSizeMm < config.ringWidthMm / 2)) errors.push('dofFontSizeMm')
  if (!(config.dofRingDiameterMm > config.ringWidthMm)) errors.push('dofRingDiameterMm')
  if (!(config.tickLengthMm > 0 && config.tickLengthMm < config.ringWidthMm)) errors.push('tickLengthMm')
  if (!(config.tickWidthMm > 0)) errors.push('tickWidthMm')
  if (!(config.fontSizeMm > 0 && config.fontSizeMm < config.ringWidthMm)) errors.push('fontSizeMm')
  if (!(config.letterSpacingMm >= -0.5 && config.letterSpacingMm <= 3)) errors.push('letterSpacingMm')
  if (!(config.frameWidthPx >= 0 && config.frameWidthPx <= 20)) errors.push('frameWidthPx')
  if (!(config.infinityMarginMm >= 0 && config.infinityMarginMm < circumferenceMm(config.ringDiameterMm) / 4)) errors.push('infinityMarginMm')
  return errors
}
