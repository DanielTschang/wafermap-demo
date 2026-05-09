import { useState, useRef, useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { OrthographicView } from '@deck.gl/core'
import { ScatterplotLayer, SolidPolygonLayer, PolygonLayer } from '@deck.gl/layers'
import type { PickingInfo } from '@deck.gl/core'
import type { SelectedDie } from './DieInfoPanel.tsx'
import type { FieldParams } from '../hooks/useWaferData.ts'
import type { ArrowPolygon } from '../utils/colormap.ts'

const WAFER_RADIUS = 150
const GRID_HALF    = 10
const LOD_ZOOM_THRESHOLD = 5

const WAFER_BOUNDARY = (() => {
  const steps = 128
  const ring = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI
    return [Math.cos(angle) * WAFER_RADIUS, Math.sin(angle) * WAFER_RADIUS]
  })
  return [{ contour: ring }]
})()

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0] as [number, number, number],
  zoom: 1.7,
  minZoom: -2,
  maxZoom: 14,
}

interface WaferMapViewProps {
  n: number
  positions: Float32Array
  colors: Uint8Array
  arrowPolygons: ArrowPolygon[]
  data: Float32Array
  fieldParams: FieldParams
  onDieClick: (die: SelectedDie) => void
}

export default function WaferMapView({
  n,
  positions,
  colors,
  arrowPolygons,
  data,
  fieldParams,
  onDieClick,
}: WaferMapViewProps) {
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom)
  const viewStateRef = useRef(INITIAL_VIEW_STATE)

  function handleClick(info: PickingInfo): void {
    if (info.index == null || info.index < 0) return
    const i = info.index
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    onDieClick({ interX, interY })
  }

  const dieBoundaries = useMemo(() => {
    const { fieldSizeX, fieldSizeY, fieldOffsetX, fieldOffsetY } = fieldParams
    const halfDiag = Math.sqrt(fieldSizeX ** 2 + fieldSizeY ** 2) / 2
    const threshold = WAFER_RADIUS - halfDiag
    const hx = fieldSizeX / 2
    const hy = fieldSizeY / 2
    const rects: { polygon: number[][] }[] = []
    for (let ix = -GRID_HALF; ix <= GRID_HALF; ix++) {
      for (let iy = -GRID_HALF; iy <= GRID_HALF; iy++) {
        const cx = ix * fieldSizeX + fieldOffsetX
        const cy = iy * fieldSizeY + fieldOffsetY
        if (Math.sqrt(cx * cx + cy * cy) <= threshold) {
          rects.push({
            polygon: [
              [cx - hx, cy - hy],
              [cx + hx, cy - hy],
              [cx + hx, cy + hy],
              [cx - hx, cy + hy],
            ],
          })
        }
      }
    }
    return rects
  }, [fieldParams])

  const showArrows = zoom >= LOD_ZOOM_THRESHOLD

  const layers = [
    new PolygonLayer({
      id: 'wafer-boundary',
      data: WAFER_BOUNDARY,
      getPolygon: (d: { contour: number[][] }) => d.contour,
      getFillColor: [20, 20, 40, 200] as [number, number, number, number],
      getLineColor: [80, 120, 200, 180] as [number, number, number, number],
      getLineWidth: 1,
      lineWidthUnits: 'pixels' as const,
      stroked: true,
      filled: true,
    }),

    new PolygonLayer({
      id: 'die-boundaries',
      data: dieBoundaries,
      getPolygon: (d: { polygon: number[][] }) => d.polygon,
      getFillColor: [0, 0, 0, 0] as [number, number, number, number],
      getLineColor: [100, 100, 160, 160] as [number, number, number, number],
      getLineWidth: 0.5,
      lineWidthUnits: 'pixels' as const,
      stroked: true,
      filled: false,
    }),

    new ScatterplotLayer({
      id: 'points',
      data: {
        length: n,
        attributes: {
          getPosition: { value: positions, size: 2 },
          getFillColor: { value: colors, size: 4 },
        },
      },
      getRadius: 0.08,
      radiusMinPixels: 1,
      radiusMaxPixels: 6,
      pickable: true,
      onClick: handleClick,
    }),

    ...(showArrows
      ? [
          new SolidPolygonLayer({
            id: 'arrows',
            data: arrowPolygons,
            getPolygon: (d: ArrowPolygon) => d.polygon,
            getFillColor: (d: ArrowPolygon) => d.color,
            filled: true,
            pickable: false,
          }),
        ]
      : []),
  ]

  return (
    <DeckGL
      views={new OrthographicView({ id: 'main' })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      onViewStateChange={({ viewState }) => {
        const vs = viewState as { zoom: number }
        viewStateRef.current = { ...INITIAL_VIEW_STATE, ...vs }
        setZoom(vs.zoom)
      }}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <div style={zoomBadgeStyle}>
        zoom {zoom.toFixed(1)} {showArrows ? '· arrows on' : ''} · {dieBoundaries.length} dies
      </div>
    </DeckGL>
  )
}

const zoomBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 8,
  left: 8,
  fontSize: 10,
  color: '#555',
  pointerEvents: 'none',
}
