import type { GeneratorConfig } from './types'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadText = (content: string, filename: string, type: string) => downloadBlob(new Blob([content], { type }), filename)

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.length)
  const view = new DataView(output.buffer)
  view.setUint32(0, data.length)
  const typeBytes = new TextEncoder().encode(type)
  output.set(typeBytes, 4); output.set(data, 8)
  const crcInput = new Uint8Array(typeBytes.length + data.length)
  crcInput.set(typeBytes); crcInput.set(data, typeBytes.length)
  view.setUint32(8 + data.length, crc32(crcInput))
  return output
}

async function addPngResolution(blob: Blob, dpi: number): Promise<Blob> {
  const source = new Uint8Array(await blob.arrayBuffer())
  const pixelsPerMetre = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint32(0, pixelsPerMetre); view.setUint32(4, pixelsPerMetre); data[8] = 1
  const chunk = pngChunk('pHYs', data)
  const output = new Uint8Array(source.length + chunk.length)
  output.set(source.slice(0, 33), 0); output.set(chunk, 33); output.set(source.slice(33), 33 + chunk.length)
  return new Blob([output], { type: 'image/png' })
}

export async function svgToPng(svg: string, config: GeneratorConfig): Promise<Blob> {
  const width = Math.max(1, Math.round(config.ringWidthMm / 25.4 * config.dpi))
  const height = Math.max(1, Math.round(Math.PI * config.ringDiameterMm / 25.4 * config.dpi))
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  const source = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(source)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG rendering failed')); image.src = url })
    context.drawImage(image, 0, 0, width, height)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png'))
    return addPngResolution(png, config.dpi)
  } finally { URL.revokeObjectURL(url) }
}
