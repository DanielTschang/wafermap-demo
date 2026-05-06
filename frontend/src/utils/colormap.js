import { interpolateViridis } from 'd3-scale-chromatic'

const ARROW_LENGTH_MM = 0.5  // fixed world-space arrow length

function parseViridisColor(rgbStr) {
  const [r, g, b] = rgbStr.match(/\d+/g).map(Number)
  return [r, g, b, 220]
}

/**
 * Pre-compute geometry arrays from raw Float32Array (one-time, on data load).
 * Returns { n, positions, arrowSources, arrowTargets }
 *   positions: Float32Array [x, y, x, y, ...] — absolute point positions
 *   arrowSources: Float32Array [x, y, ...] — arrow start positions (same as positions)
 *   arrowTargets: Float32Array [x, y, ...] — arrow end positions (normalized direction * ARROW_LENGTH_MM)
 */
export function prepareWaferArrays(data) {
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

/**
 * Build RGBA Uint8Array from overlay magnitudes.
 * Recomputed whenever colorMin or colorMax changes.
 */
export function buildColorArray(data, colorMin, colorMax) {
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
