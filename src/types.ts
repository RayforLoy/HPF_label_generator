export type Language = 'zh' | 'en'
export type Theme = 'dark' | 'light'
export type ScaleDirection = 'clockwise' | 'counterclockwise'
export type CocMode = 'film135' | 'kodak35' | 'fullFrame24mp' | 'customSensor'

export interface ScaleSegment {
  id: string
  count: number
  stepDeg: number
}

export interface Lens {
  lensName: string
  vender: string
  version: string
  nominalFocalLength: number | null
  nominalFNumber: number | null
  efl: number | null
  [key: string]: string | number | null
}

export interface GeneratorConfig {
  lensName: string
  focalLengthMm: number
  focalSource: 'efl' | 'nominal' | 'manual'
  extensionMmPerDeg: number
  maxAngleDeg: number
  scaleSegments: ScaleSegment[]
  layoutSegmentId: string
  scaleDirection: ScaleDirection
  ringDiameterMm: number
  ringWidthMm: number
  frontInnerDiameterMm: number
  frontOuterDiameterMm: number
  cocMode: CocMode
  sensorWidthMm: number
  sensorHeightMm: number
  sensorMegapixels: number
  maxApertureFNumber: number
  dofStops: number
  dofFontSizeMm: number
  dofRingDiameterMm: number
  significantDigits: number
  distanceUnit: 'm' | 'ft'
  dpi: number
  tickLengthMm: number
  tickWidthMm: number
  fontSizeMm: number
  letterSpacingMm: number
  frameWidthPx: number
  infinityMarginMm: number
  showFocalLength: boolean
  transparentBackground: boolean
  backgroundColor: string
  tickColor: string
  textColor: string
  fontId: string
  fontName: string
}

export interface ScaleMark {
  angleDeg: number
  distanceM: number
  label: string
  major: boolean
}

export interface FontChoice {
  id: string
  label: string
  url: string
  family: string
}
