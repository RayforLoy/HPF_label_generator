import opentype from 'opentype.js'
import squareUrl from '../Square721 Cn BT Bold.ttf?url'
import robotoUrl from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url'
import robotoCondensedUrl from '@fontsource/roboto-condensed/files/roboto-condensed-latin-400-normal.woff?url'
import robotoMonoUrl from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url'
import type { FontChoice } from './types'

export const BUILT_IN_FONTS: FontChoice[] = [
  { id: 'square721', label: 'Square721 Cn BT Bold', family: 'Square721', url: squareUrl },
  { id: 'roboto-condensed', label: 'Roboto Condensed', family: 'Roboto Condensed', url: robotoCondensedUrl },
  { id: 'roboto', label: 'Roboto', family: 'Roboto', url: robotoUrl },
  { id: 'roboto-mono', label: 'Roboto Mono', family: 'Roboto Mono', url: robotoMonoUrl },
]

const cache = new Map<string, opentype.Font>()

export async function loadFont(url: string): Promise<opentype.Font> {
  const cached = cache.get(url)
  if (cached) return cached
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Font request failed: ${response.status}`)
  const font = opentype.parse(await response.arrayBuffer())
  cache.set(url, font)
  return font
}

export async function loadUploadedFont(file: File): Promise<{ font: opentype.Font; url: string }> {
  const buffer = await file.arrayBuffer()
  const font = opentype.parse(buffer)
  const url = URL.createObjectURL(file)
  cache.set(url, font)
  return { font, url }
}
