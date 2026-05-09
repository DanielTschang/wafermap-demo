import { interpolateViridis } from 'd3-scale-chromatic'

const VECTOR_SCALE_MM_PER_NM = 0.01
const SHAFT_WIDTH_MM         = 0.03
const HEAD_WIDTH_MM          = 0.09
const HEAD_LENGTH_RATIO      = 0.25

function rotateVertex(
  px: number, py: number,
  x: number, y: number,
  dx: number, dy: number,
): [number, number] {
  return [x + px * dy + py * dx, y - px * dx + py * dy]
}

export interface ArrowPolygon {
  polygon: [number, number][]
  color: [number, number, number, number]
}

export interface WaferArrays {
  n: number
  positions: Float32Array
}

function parseViridisColor(rgbStr: string): [number, number, number, number] {
  const matches = rgbStr.match(/\d+/g)!
  const [r, g, b] = matches.map(Number)
  return [r, g, b, 220]
}

export function prepareWaferArrays(data: Float32Array): WaferArrays {
  const n = data.length / 6
  const positions = new Float32Array(n * 2)

  for (let i = 0; i < n; i++) {
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    const intraX = data[i * 6 + 2]
    const intraY = data[i * 6 + 3]
    positions[i * 2]     = interX + intraX
    positions[i * 2 + 1] = interY + intraY
  }

  return { n, positions }
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

export function buildArrowPolygons(
  data: Float32Array,
  colorMin: number,
  colorMax: number,
): ArrowPolygon[] {
  const n = data.length / 6
  const range = colorMax - colorMin || 1
  const polygons: ArrowPolygon[] = []

  const sw = SHAFT_WIDTH_MM / 2
  const hw = HEAD_WIDTH_MM / 2

  for (let i = 0; i < n; i++) {
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    const intraX = data[i * 6 + 2]
    const intraY = data[i * 6 + 3]
    const ovlX   = data[i * 6 + 4]
    const ovlY   = data[i * 6 + 5]

    const mag = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
    if (mag < 1e-9) continue

    const x = interX + intraX
    const y = interY + intraY
    const dx = ovlX / mag  // unit vector x
    const dy = ovlY / mag  // unit vector y

    const displayLen = mag * VECTOR_SCALE_MM_PER_NM
    const shaftLen   = displayLen * (1 - HEAD_LENGTH_RATIO)
    const headLen    = displayLen * HEAD_LENGTH_RATIO

    const polygon: [number, number][] = [
      rotateVertex(-sw, 0,              x, y, dx, dy),
      rotateVertex(-sw, shaftLen,       x, y, dx, dy),
      rotateVertex(-hw, shaftLen,       x, y, dx, dy),
      rotateVertex(  0, shaftLen + headLen, x, y, dx, dy),
      rotateVertex( hw, shaftLen,       x, y, dx, dy),
      rotateVertex( sw, shaftLen,       x, y, dx, dy),
      rotateVertex( sw, 0,              x, y, dx, dy),
    ]

    const t = Math.max(0, Math.min(1, (mag - colorMin) / range))
    const color = parseViridisColor(interpolateViridis(t))

    polygons.push({ polygon, color })
  }

  return polygons
}
