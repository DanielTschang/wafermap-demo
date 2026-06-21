import { useState, useEffect, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { OrthographicView } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'

interface QuadrantViewProps {
  data: Float32Array | null
}

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0] as [number, number, number],
  zoom: 3,
  minZoom: -2,
  maxZoom: 16,
}

const POINT_COLOR: [number, number, number, number] = [100, 160, 255, 120]

interface ViewState {
  zoom: number
  target: [number, number, number]
}

export default function QuadrantView({ data }: QuadrantViewProps) {
  const n = data ? data.length / 6 : 0

  const [vs, setVs] = useState<ViewState>({
    zoom: INITIAL_VIEW_STATE.zoom,
    target: INITIAL_VIEW_STATE.target,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setContainerSize({ w: width, h: height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // World origin → screen pixels for axis overlay.
  // OrthographicView: screenX = w/2 + (worldX − targetX) × 2^zoom
  //                   screenY = h/2 − (worldY − targetY) × 2^zoom
  const scale = Math.pow(2, vs.zoom)
  const originX = containerSize.w / 2 - vs.target[0] * scale
  const originY = containerSize.h / 2 + vs.target[1] * scale

  const layer =
    data && n > 0
      ? new ScatterplotLayer({
          id: 'quadrant-points',
          data: {
            length: n,
            attributes: {
              getPosition: {
                value: data,
                size: 2,
                stride: 24, // 6 floats × 4 bytes per record
                offset: 16, // skip interX, interY, intraX, intraY (4 × 4 bytes)
              },
            },
          },
          getRadius: 0.3,
          radiusMinPixels: 1,
          radiusMaxPixels: 4,
          getFillColor: POINT_COLOR,
          pickable: false,
        })
      : null

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <DeckGL
        views={new OrthographicView({ id: 'quadrant' })}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layer ? [layer] : []}
        onViewStateChange={({ viewState }) => {
          const v = viewState as ViewState
          setVs({ zoom: v.zoom, target: v.target })
        }}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      {/* Horizontal axis line at Y=0 */}
      <div
        style={{
          position: 'absolute',
          top: originY,
          left: 0,
          right: 0,
          height: 0,
          borderTop: '1px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
      {/* Vertical axis line at X=0 */}
      <div
        style={{
          position: 'absolute',
          left: originX,
          top: 0,
          bottom: 0,
          width: 0,
          borderLeft: '1px solid rgba(255,255,255,0.3)',
          pointerEvents: 'none',
        }}
      />
      {/* Axis labels */}
      <div style={labelStyle({ bottom: 8, left: '50%', transform: 'translateX(-50%)' })}>
        ovlX (nm)
      </div>
      <div style={labelStyle({ top: '50%', left: 8, transform: 'translateY(-50%)' })}>
        ovlY (nm)
      </div>
      {/* Chart title */}
      <div style={labelStyle({ top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 11 })}>
        Overlay Quadrant
      </div>
    </div>
  )
}

function labelStyle(extra: React.CSSProperties): React.CSSProperties {
  return {
    position: 'absolute',
    fontSize: 10,
    color: '#888',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    ...extra,
  }
}
