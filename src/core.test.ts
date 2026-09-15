import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, apertureStops, buildScaleMarks, circleOfConfusionMm, circumferenceMm, depthOfFieldAngleDeg, distanceAtAngle, focalLengthFor, formatDistance, generatedMaxAngle, parseLensCsv, validateConfig } from './core'
import { contrastColor, createFrontArtwork, createFrontDxf, markPositionMm } from './artwork'

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

  it('keeps one-degree ticks inside and outer ticks on the selected five-degree interval', () => {
    const dxf = createFrontDxf(DEFAULT_CONFIG)
    expect(dxf.match(/8\nANGLE_TICKS\n/g)).toHaveLength(166)
    expect(dxf.match(/8\nDISTANCE_TICKS\n/g)).toHaveLength(34)
  })

  it('calculates film and pixel-pitch circles of confusion', () => {
    expect(circleOfConfusionMm(DEFAULT_CONFIG)).toBeCloseTo(Math.hypot(36, 24) / 1500, 8)
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
