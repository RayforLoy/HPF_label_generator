import type { GeneratorConfig, Lens, ScaleMark } from './types'

export const DEFAULT_CONFIG: GeneratorConfig = {
  lensName: 'Makro-Symmar 180 HM', focalLengthMm: 179.9, focalSource: 'manual',
  extensionMmPerDeg: 4 / 45, maxAngleDeg: 165, ringDiameterMm: 86.7, ringWidthMm: 9.5,
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
  const angles = [0]
  for (let angle = 1; angle <= Math.min(4, config.maxAngleDeg); angle += 1) angles.push(angle)
  for (let angle = 5; angle <= config.maxAngleDeg; angle += 5) angles.push(angle)
  return angles.map((angleDeg) => {
    const distanceM = distanceAtAngle(config.focalLengthMm, config.extensionMmPerDeg, angleDeg)
    return { angleDeg, distanceM, label: formatDistance(distanceM, config.significantDigits, config.distanceUnit), major: angleDeg === 0 || angleDeg % 10 === 0 }
  })
}

export const circumferenceMm = (diameterMm: number) => Math.PI * diameterMm

export function validateConfig(config: GeneratorConfig): string[] {
  const errors: string[] = []
  if (!(config.focalLengthMm > 0)) errors.push('focalLengthMm')
  if (!(config.extensionMmPerDeg > 0)) errors.push('extensionMmPerDeg')
  if (!(config.maxAngleDeg >= 5 && config.maxAngleDeg <= 355)) errors.push('maxAngleDeg')
  if (!(config.ringDiameterMm > 0)) errors.push('ringDiameterMm')
  if (!(config.ringWidthMm > 0)) errors.push('ringWidthMm')
  if (!(config.tickLengthMm > 0 && config.tickLengthMm < config.ringWidthMm)) errors.push('tickLengthMm')
  if (!(config.tickWidthMm > 0)) errors.push('tickWidthMm')
  if (!(config.fontSizeMm > 0 && config.fontSizeMm < config.ringWidthMm)) errors.push('fontSizeMm')
  if (!(config.letterSpacingMm >= -0.5 && config.letterSpacingMm <= 3)) errors.push('letterSpacingMm')
  if (!(config.frameWidthPx >= 0 && config.frameWidthPx <= 20)) errors.push('frameWidthPx')
  if (!(config.infinityMarginMm >= 0 && config.infinityMarginMm < circumferenceMm(config.ringDiameterMm) / 4)) errors.push('infinityMarginMm')
  return errors
}
