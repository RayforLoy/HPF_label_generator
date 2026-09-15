export type Language = 'zh' | 'en'
export type Theme = 'dark' | 'light'

export interface Lens {
  lensName: string
  vender: string
  version: string
  nominalFocalLength: number | null
  efl: number | null
  [key: string]: string | number | null
}

export interface GeneratorConfig {
  lensName: string
  focalLengthMm: number
  focalSource: 'efl' | 'nominal' | 'manual'
  extensionMmPerDeg: number
  maxAngleDeg: number
  ringDiameterMm: number
  ringWidthMm: number
  significantDigits: number
  dpi: number
  tickLengthMm: number
  tickWidthMm: number
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
