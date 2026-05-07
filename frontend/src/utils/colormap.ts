import { interpolateViridis } from 'd3-scale-chromatic'

const ARROW_LENGTH_MM = 0.5

export interface WaferArrays {
  n: number
  positions: Float32Array
  arrowSources: Float32Array
  arrowTargets: Float32Array
}

function parseViridisColor(rgbStr: string): [number, number, number, number] {
  const matches = rgbStr.match(/\d+/g)!
  const [r, g, b] = matches.map(Number)
  return [r, g, b, 220]
}

export function prepareWaferArrays(data: Float32Array): WaferArrays {
  const n = data.length / 6
  const positions    = new Float32Array(n * 2)
  const arrowSources = new Float32Array(n * 2)
  const arrowTargets = new Float32Array(n * 2)

  for (let i = 0; i < n; i++) {
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    const intraX = data[i * 6 + 2]
    const intraY = data[i * 6 + 3]
    const ovlX   = data[i * 6 + 4]
    const ovlY   = data[i * 6 + 5]

    const x = interX + intraX
    const y = interY + intraY

    positions[i * 2]     = x
    positions[i * 2 + 1] = y

    arrowSources[i * 2]     = x
    arrowSources[i * 2 + 1] = y

    const mag = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
    const scale = mag > 0 ? ARROW_LENGTH_MM / mag : 0
    arrowTargets[i * 2]     = x + ovlX * scale
    arrowTargets[i * 2 + 1] = y + ovlY * scale
  }

  return { n, positions, arrowSources, arrowTargets }
}

export function buildColorArray(data: Float32Array, colorMin: number, colorMax: number): Uint8Array {
  const n = data.length / 6
  const colors = new Uint8Array(n * 4)
  const range = colorMax - colorMin || 1

  for (let i = 0; i < n; i++) {
    const ovlX = data[i * 6 + 4]
    const ovlY = data[i * 6 + 5]
    const mag  = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
    const t    = Math.max(0, Math.min(1, (mag - colorMin) / range))
    const [r, g, b, a] = parseViridisColor(interpolateViridis(t))
    colors[i * 4]     = r
    colors[i * 4 + 1] = g
    colors[i * 4 + 2] = b
    colors[i * 4 + 3] = a
  }

  return colors
}
