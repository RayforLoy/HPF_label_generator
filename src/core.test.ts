import { describe, expect, it } from 'vitest'
import type opentype from 'opentype.js'
import { DEFAULT_CONFIG, apertureStops, buildScaleMarks, circleOfConfusionMm, circumferenceMm, depthOfFieldAngleDeg, distanceAtAngle, focalLengthFor, formatDistance, generatedMaxAngle, layoutAngleForMark, parseLensCsv, validateConfig } from './core'
import { contrastColor, createDofArtwork, createDofDxf, createFrontArtwork, createFrontDxf, markPositionMm } from './artwork'

const mockFont = {
  getAdvanceWidth: (text: string) => text.length,
  getPath: () => ({ commands: [{ type: 'M', x: 0, y: 0 }, { type: 'L', x: 1, y: 0 }, { type: 'L', x: 1, y: 1 }, { type: 'Z' }], toPathData: () => 'M0 0L1 0L1 1Z' }),
} as unknown as opentype.Font

describe('lens database', () => {
  it('skips the metadata preamble and parses numeric fields', () => {
    const csv = 'lensDB by rayfor,,,,\n,,,,\nlensName,vender,version,nominalFocalLength,efl\nTest Lens,Maker,v1,150,149.7\n'
    expect(parseLensCsv(csv)).toEqual([expect.objectContaining({ lensName: 'Test Lens', nominalFocalLength: 150, efl: 149.7 })])
  })

  it('prefers EFL and falls back to nominal focal length', () => {
    const base = { lensName: 'A', vender: 'B', version: 'C', nominalFNumber: 5.6 }
    expect(focalLengthFor({ ...base, nominalFocalLength: 150, efl: 149.7 })).toEqual({ value: 149.7, source: 'efl' })
    expect(focalLengthFor({ ...base, nominalFocalLength: 150, efl: null })).toEqual({ value: 150, source: 'nominal' })
  })
})

describe('scale calculation', () => {
  it('returns infinity at the zero-angle datum', () => {
    expect(distanceAtAngle(180, 4 / 45, 0)).toBe(Number.POSITIVE_INFINITY)
  })

  it('matches the thin-lens equation for a finite angle', () => {
    expect(distanceAtAngle(100, 0.1, 10)).toBeCloseTo(10.201, 6)
  })

  it('creates the fine 1–4° marks followed by 5° increments', () => {
    const marks = buildScaleMarks({ ...DEFAULT_CONFIG, scaleSegments: [{ id: 'fine', count: 5, stepDeg: 1 }, { id: 'coarse', count: 3, stepDeg: 5 }] })
    expect(marks.map((mark) => mark.angleDeg)).toEqual([0, 1, 2, 3, 4, 5, 10, 15, 20])
    expect(marks[0].label).toBe('INF')
    expect(formatDistance(12.3456, 4)).toBe('12.35')
    expect(formatDistance(0.2545, 4)).toBe('0.255')
  })

  it('pads distance labels with zeroes to the requested digit count', () => {
    expect(formatDistance(12.3, 4)).toBe('12.30')
    expect(formatDistance(2, 4)).toBe('2.000')
    expect(formatDistance(0.25, 4)).toBe('0.250')
    expect(formatDistance(1200, 4)).toBe('1.200k')
    expect(formatDistance(12345, 4)).toBe('12.35k')
  })

  it('uses physical circumference and rejects unsafe dimensions', () => {
    expect(circumferenceMm(86.7)).toBeCloseTo(272.376, 3)
    expect(validateConfig({ ...DEFAULT_CONFIG, tickLengthMm: 12 })).toContain('tickLengthMm')
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  it('uses the requested production defaults', () => {
    expect(DEFAULT_CONFIG).toEqual(expect.objectContaining({ fontSizeMm: 2.6, letterSpacingMm: 0, frameWidthPx: 2, infinityMarginMm: 2, frontInnerDiameterMm: 75, frontOuterDiameterMm: 100 }))
    expect(generatedMaxAngle(DEFAULT_CONFIG)).toBe(165)
  })

  it('chooses an inverse frame colour from the background', () => {
    expect(contrastColor('#050505')).toBe('#ffffff')
    expect(contrastColor('#f4f4f4')).toBe('#000000')
  })

  it('converts distance labels to feet when requested', () => {
    expect(formatDistance(10, 4, 'ft')).toBe('32.81')
    const metric = buildScaleMarks({ ...DEFAULT_CONFIG, maxAngleDeg: 5, distanceUnit: 'm' })
    const imperial = buildScaleMarks({ ...DEFAULT_CONFIG, maxAngleDeg: 5, distanceUnit: 'ft' })
    expect(imperial[1].distanceM).toBe(metric[1].distanceM)
    expect(imperial[1].label).not.toBe(metric[1].label)
  })

  it('keeps the INF-to-first-mark gap equal to every following gap', () => {
    const positions = [0, 1, 2, 3].map((index) => markPositionMm(index, DEFAULT_CONFIG))
    const gaps = positions.slice(1).map((position, index) => position - positions[index])
    expect(gaps[0]).toBeCloseTo(gaps[1], 8)
    expect(gaps[1]).toBeCloseTo(gaps[2], 8)
    expect(positions[0]).toBe(DEFAULT_CONFIG.infinityMarginMm)
  })

  it('lets unfolded spacing follow any selected segment', () => {
    const fineGap = markPositionMm(1, { ...DEFAULT_CONFIG, layoutSegmentId: 'fine' }) - DEFAULT_CONFIG.infinityMarginMm
    const coarseGap = markPositionMm(1, { ...DEFAULT_CONFIG, layoutSegmentId: 'coarse' }) - DEFAULT_CONFIG.infinityMarginMm
    expect(coarseGap / fineGap).toBeCloseTo(5, 8)
  })

  it('creates a production front sticker without preview annotations', () => {
    const production = createFrontArtwork(DEFAULT_CONFIG)
    const guided = createFrontArtwork(DEFAULT_CONFIG, true)
    expect(production.widthMm).toBe(100)
    expect(production.svg).not.toContain('<text')
    expect(guided.svg).toContain('100%')
  })

  it('rejects invalid front diameters and angle segments', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, frontOuterDiameterMm: 70 })).toContain('frontOuterDiameterMm')
    expect(validateConfig({ ...DEFAULT_CONFIG, scaleSegments: [{ id: 'bad', count: 0, stepDeg: 5 }], layoutSegmentId: 'bad' })).toContain('scaleSegments')
  })

  it('keeps one-degree ticks inside and connects every evenly spaced outer HPF mark', () => {
    const dxf = createFrontDxf(DEFAULT_CONFIG)
    expect(dxf.match(/8\nANGLE_TICKS\n/g)).toHaveLength(166)
    expect(dxf.match(/8\nDISTANCE_TICKS\n/g)).toHaveLength(38)
    expect(dxf.match(/8\nCONNECTORS\n/g)).toHaveLength(38)
  })

  it('anchors outer spacing at the first mark of the selected main segment', () => {
    expect(layoutAngleForMark(0, DEFAULT_CONFIG)).toBe(-20)
    expect(layoutAngleForMark(5, DEFAULT_CONFIG)).toBe(5)
    expect(layoutAngleForMark(6, DEFAULT_CONFIG)).toBe(10)
    const actual = buildScaleMarks(DEFAULT_CONFIG).map((mark) => mark.angleDeg)
    for (let index = 5; index < actual.length; index += 1) expect(layoutAngleForMark(index, DEFAULT_CONFIG)).toBe(actual[index])
  })

  it('unfolds the connected focusing scale around its own barrel diameter', () => {
    const config = { ...DEFAULT_CONFIG, frontShape: 'strip' as const, frontBarrelDiameterMm: 90 }
    const artwork = createFrontArtwork(config)
    expect(artwork.widthMm).toBeCloseTo(Math.PI * 90, 8)
    expect(artwork.heightMm).toBe(DEFAULT_CONFIG.ringWidthMm)
    expect(artwork.svg).toContain('side focusing scale')
    expect(artwork.svg).not.toContain('100%')
    expect(createFrontArtwork(config, true).svg).toContain('100%')
    expect(createFrontDxf(config)).not.toContain('\nCIRCLE\n')
  })

  it('supports DOF label visibility, direction, line width, and annular diameters', () => {
    const shown = createDofArtwork({ ...DEFAULT_CONFIG, dofTextDirection: 'reverse', dofTickWidthMm: 0.35 }, mockFont)
    const hidden = createDofArtwork({ ...DEFAULT_CONFIG, dofShowLabels: false }, mockFont)
    expect(shown.widthMm).toBe(DEFAULT_CONFIG.dofOuterDiameterMm)
    expect(shown.svg).toContain('rotate(180')
    expect(shown.svg).toContain('stroke-width="0.35"')
    expect(shown.svg.match(/<path/g)).toHaveLength(19)
    expect(hidden.svg.match(/<path/g)).toHaveLength(7)
    expect(createDofDxf({ ...DEFAULT_CONFIG, dofShowLabels: false }, mockFont)).not.toContain('TEXT_OUTLINES')
  })

  it('creates compact or nested rectangular DOF stickers from barrel diameter', () => {
    const nested = { ...DEFAULT_CONFIG, dofShape: 'strip' as const, dofRingDiameterMm: 92 }
    const compact = { ...nested, dofStyle: 'compact' as const }
    expect(createDofArtwork(nested, mockFont).widthMm).toBeCloseTo(Math.PI * 92, 8)
    expect(createDofArtwork(nested, mockFont).svg).toContain('side depth of field scale')
    expect(createDofArtwork(compact, mockFont).svg).toContain('<line')
    expect(createDofDxf(compact, mockFont)).not.toContain('\nCIRCLE\n')
  })

  it('calculates film and pixel-pitch circles of confusion', () => {
    expect(circleOfConfusionMm(DEFAULT_CONFIG)).toBeCloseTo(Math.hypot(36, 24) / 1500, 8)
    expect(circleOfConfusionMm({ ...DEFAULT_CONFIG, cocMode: 'film6x9' })).toBeCloseTo(Math.hypot(56, 84) / 1500, 8)
    expect(circleOfConfusionMm({ ...DEFAULT_CONFIG, cocMode: 'film4x5' })).toBeCloseTo(Math.hypot(96, 120) / 1500, 8)
    expect(circleOfConfusionMm({ ...DEFAULT_CONFIG, cocMode: 'fullFrame24mp' })).toBeCloseTo(0.006, 3)
    expect(circleOfConfusionMm({ ...DEFAULT_CONFIG, cocMode: 'customSensor', sensorWidthMm: 36, sensorHeightMm: 24, sensorMegapixels: 24 })).toBeCloseTo(0.006, 3)
  })

  it('generates five stopped-down aperture intervals and their angular offsets', () => {
    const stops = apertureStops(DEFAULT_CONFIG)
    expect(stops).toHaveLength(6)
    expect(stops[0]).toBe(5.6)
    expect(stops[5]).toBeCloseTo(31.678, 3)
    expect(depthOfFieldAngleDeg(8, 0.03, 0.1)).toBeCloseTo(2.4, 8)
  })
})
