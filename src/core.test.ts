import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, buildScaleMarks, circumferenceMm, distanceAtAngle, focalLengthFor, formatDistance, parseLensCsv, validateConfig } from './core'
import { contrastColor, markPositionMm } from './artwork'

describe('lens database', () => {
  it('skips the metadata preamble and parses numeric fields', () => {
    const csv = 'lensDB by rayfor,,,,\n,,,,\nlensName,vender,version,nominalFocalLength,efl\nTest Lens,Maker,v1,150,149.7\n'
    expect(parseLensCsv(csv)).toEqual([expect.objectContaining({ lensName: 'Test Lens', nominalFocalLength: 150, efl: 149.7 })])
  })

  it('prefers EFL and falls back to nominal focal length', () => {
    const base = { lensName: 'A', vender: 'B', version: 'C' }
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
    const marks = buildScaleMarks({ ...DEFAULT_CONFIG, maxAngleDeg: 20 })
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
    expect(DEFAULT_CONFIG).toEqual(expect.objectContaining({ fontSizeMm: 2.6, letterSpacingMm: 0, frameWidthPx: 2, infinityMarginMm: 2 }))
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
})
