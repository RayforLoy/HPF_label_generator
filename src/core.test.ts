import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, buildScaleMarks, circumferenceMm, distanceAtAngle, focalLengthFor, formatDistance, parseLensCsv, validateConfig } from './core'

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
})
