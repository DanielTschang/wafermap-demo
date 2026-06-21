import { useState, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import type { CSSProperties } from 'react'
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

const QUADRANT_VIEW = new OrthographicView({ id: 'quadrant' })

interface ViewState {
  zoom: number
  target: [number, number, number]
}

export default function QuadrantView({ data }: QuadrantViewProps) {
  const [vs, setVs] = useState<ViewState>({
    zoom: INITIAL_VIEW_STATE.zoom,
    target: INITIAL_VIEW_STATE.target,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setContainerSize({ w: width, h: height })
    const obs = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect
      setContainerSize({ w, h })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Target is locked to [0,0,0], so world origin always projects to screen center
  const cx = containerSize.w / 2
  const cy = containerSize.h / 2

  const layer = useMemo(
    () =>
      data && data.length > 0
        ? new ScatterplotLayer({
            id: 'quadrant-points',
            data: {
              length: data.length / 6,
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
        : null,
    [data],
  )

  const handleViewStateChange = useCallback(
    ({ viewState }: { viewState: Record<string, unknown> }) => {
      setVs(prev => ({
        ...prev,
        zoom: (viewState.zoom as number) ?? INITIAL_VIEW_STATE.zoom,
      }))
    },
    [],
  )

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Deliberately no deviceProps — WaferMapView owns the single WebGPU device. */}
      <DeckGL
        views={QUADRANT_VIEW}
        viewState={{ ...INITIAL_VIEW_STATE, zoom: vs.zoom }}
        controller={true}
        layers={layer ? [layer] : []}
        onViewStateChange={handleViewStateChange}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      {/* Main axes — always at screen center because target is locked to [0,0,0] */}
      <div style={{ position: 'absolute', top: cy, left: 0, right: 0, height: 0, borderTop: '1px solid rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: cx, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
      {/* Axis labels */}
      <div style={labelStyle({ bottom: 8, left: '50%', transform: 'translateX(-50%)' })}>
        ovlX (nm)
      </div>
      <div style={labelStyle({ top: '50%', left: 8, transform: 'translateY(-50%) rotate(-90deg)' })}>
        ovlY (nm)
      </div>
      {/* Chart title */}
      <div style={labelStyle({ top: 8, left: '50%', transform: 'translateX(-50%)', fontSize: 11 })}>
        Overlay Quadrant
      </div>
    </div>
  )
}

function labelStyle(extra: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    fontSize: 10,
    color: '#888',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    ...extra,
  }
}
