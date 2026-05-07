import { useState, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { OrthographicView } from '@deck.gl/core'
import { ScatterplotLayer, LineLayer, PolygonLayer } from '@deck.gl/layers'

const WAFER_RADIUS = 150  // mm
const LOD_ZOOM_THRESHOLD = 5

// Build a circle polygon for the wafer boundary
const WAFER_BOUNDARY = (() => {
  const steps = 128
  const ring = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI
    return [Math.cos(angle) * WAFER_RADIUS, Math.sin(angle) * WAFER_RADIUS]
  })
  return [{ contour: ring }]
})()

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0],
  zoom: 1.7,
  minZoom: -2,
  maxZoom: 14,
}

export default function WaferMapView({
  n,            // number of points
  positions,    // Float32Array [x,y, x,y, ...]
  colors,       // Uint8Array   [r,g,b,a, ...]
  arrowSources, // Float32Array for LOD arrows
  arrowTargets, // Float32Array for LOD arrows
  data,         // raw Float32Array (for die lookup on click)
  onDieClick,
}) {
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom)
  const viewStateRef = useRef(INITIAL_VIEW_STATE)

  function handleClick(info) {
    if (info.index == null || info.index < 0 || !data) return
    const i = info.index
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    onDieClick({ interX, interY })
  }

  const showArrows = zoom >= LOD_ZOOM_THRESHOLD

  const layers = [
    new PolygonLayer({
      id: 'wafer-boundary',
      data: WAFER_BOUNDARY,
      getPolygon: d => d.contour,
      getFillColor: [20, 20, 40, 200],
      getLineColor: [80, 120, 200, 180],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: true,
    }),

    positions && new ScatterplotLayer({
      id: 'points',
      data: {
        length: n,
        attributes: {
          getPosition: { value: positions, size: 2 },
          getFillColor: { value: colors,    size: 4 },
        },
      },
      getRadius: 0.08,
      radiusMinPixels: 1,
      radiusMaxPixels: 6,
      pickable: true,
      onClick: handleClick,
    }),

    showArrows && arrowSources && new LineLayer({
      id: 'arrows',
      data: {
        length: n,
        attributes: {
          getSourcePosition: { value: arrowSources, size: 2 },
          getTargetPosition: { value: arrowTargets, size: 2 },
        },
      },
      getColor: [255, 255, 255, 160],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
  ].filter(Boolean)

  return (
    <DeckGL
      views={new OrthographicView({ id: 'main' })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      onViewStateChange={({ viewState }) => {
        viewStateRef.current = viewState
        setZoom(viewState.zoom)
      }}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <div style={zoomBadgeStyle}>
        zoom {zoom.toFixed(1)} {showArrows ? '· arrows on' : ''}
      </div>
    </DeckGL>
  )
}

const zoomBadgeStyle = {
  position: 'absolute',
  bottom: 8,
  left: 8,
  fontSize: 10,
  color: '#555',
  pointerEvents: 'none',
}
