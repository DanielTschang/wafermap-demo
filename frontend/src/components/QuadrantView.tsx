import { useState, useLayoutEffect, useRef, useMemo, useCallback, Fragment } from 'react'
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

const PANEL_STYLE: CSSProperties = {
  position: 'absolute', top: 8, right: 8,
  background: 'rgba(10,10,24,0.85)', borderRadius: 6, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
  pointerEvents: 'auto', zIndex: 10,
}
const ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
}
const LABEL_TEXT_STYLE: CSSProperties = {
  fontSize: 11, color: '#888', width: 40,
}
const INPUT_STYLE: CSSProperties = {
  width: 56, fontSize: 11, background: '#1a1a2e', color: '#e0e0e0',
  border: '1px solid #333', borderRadius: 3, padding: '2px 4px',
}
const UNIT_STYLE: CSSProperties = {
  fontSize: 10, color: '#555',
}

export default function QuadrantView({ data }: QuadrantViewProps) {
  const [vs, setVs] = useState<ViewState>({
    zoom: INITIAL_VIEW_STATE.zoom,
    target: INITIAL_VIEW_STATE.target,
  })
  const [axis, setAxis] = useState<number>(20)
  const [specX, setSpecX] = useState<number>(0)
  const [specY, setSpecY] = useState<number>(0)

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

  // CPU-side clip: keep only records where |ovlX| ≤ axis && |ovlY| ≤ axis.
  // axis ≤ 0 means no clipping.
  const clippedData = useMemo(() => {
    if (!data || axis <= 0) return data
    const n = data.length / 6
    const out = new Float32Array(data.length)
    let count = 0
    for (let i = 0; i < n; i++) {
      if (Math.abs(data[i * 6 + 4]) <= axis && Math.abs(data[i * 6 + 5]) <= axis) {
        out.set(data.subarray(i * 6, i * 6 + 6), count++ * 6)
      }
    }
    return out.subarray(0, count * 6)
  }, [data, axis])

  const layer = useMemo(
    () =>
      clippedData && clippedData.length > 0
        ? new ScatterplotLayer({
            id: 'quadrant-points',
            data: {
              length: clippedData.length / 6,
              attributes: {
                getPosition: {
                  value: clippedData,
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
    [clippedData],
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

  // Integer indices 1…axis for gridline rendering
  const scale = Math.pow(2, vs.zoom)
  const gridIndices = axis > 0
    ? Array.from({ length: Math.floor(axis) }, (_, i) => i + 1).filter(
        i => i * scale < containerSize.w + containerSize.h,
      )
    : []

  const showSpec = specX > 0 && specY > 0

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
      {/* Gridlines at ±1, ±2, …, ±axis */}
      {gridIndices.map(i => (
        <Fragment key={i}>
          {/* Vertical gridline at X = +i */}
          <div style={{ position: 'absolute', left: cx + i * scale, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ top: cy - 12 })}>{i}</span>
          </div>
          {/* Vertical gridline at X = -i */}
          <div style={{ position: 'absolute', left: cx - i * scale, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ top: cy - 12 })}>-{i}</span>
          </div>
          {/* Horizontal gridline at Y = +i */}
          <div style={{ position: 'absolute', top: cy - i * scale, left: 0, right: 0, height: 0, borderTop: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ left: cx + 4 })}>{i}</span>
          </div>
          {/* Horizontal gridline at Y = -i */}
          <div style={{ position: 'absolute', top: cy + i * scale, left: 0, right: 0, height: 0, borderTop: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ left: cx + 4 })}>-{i}</span>
          </div>
        </Fragment>
      ))}
      {/* Spec rectangle — assumes specX/Y are reasonable (≤100K nm); extreme values at maxZoom may overflow CSS pixels */}
      {showSpec && (
        <div
          style={{
            position: 'absolute',
            left: cx - specX * scale,
            top: cy - specY * scale,
            width: 2 * specX * scale,
            height: 2 * specY * scale,
            border: '1.5px solid rgba(220,50,50,0.85)',
            background: 'rgba(220,50,50,0.05)',
            pointerEvents: 'none',
          }}
        />
      )}
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
      {/* Floating control panel */}
      <div style={PANEL_STYLE}>
        <div style={ROW_STYLE}>
          <span style={LABEL_TEXT_STYLE}>Axis</span>
          <input
            type="number" min="0" style={INPUT_STYLE} value={axis}
            onChange={e => setAxis(Number(e.target.value))}
          />
          <span style={UNIT_STYLE}>nm</span>
        </div>
        <div style={ROW_STYLE}>
          <span style={LABEL_TEXT_STYLE}>Spec X</span>
          <input
            type="number" min="0" style={INPUT_STYLE} value={specX}
            onChange={e => setSpecX(Number(e.target.value))}
          />
          <span style={UNIT_STYLE}>±nm</span>
        </div>
        <div style={ROW_STYLE}>
          <span style={LABEL_TEXT_STYLE}>Spec Y</span>
          <input
            type="number" min="0" style={INPUT_STYLE} value={specY}
            onChange={e => setSpecY(Number(e.target.value))}
          />
          <span style={UNIT_STYLE}>±nm</span>
        </div>
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

function gridLabelStyle(extra: CSSProperties): CSSProperties {
  return {
    position: 'absolute',
    fontSize: 9,
    color: '#555',
    pointerEvents: 'none',
    lineHeight: '1',
    whiteSpace: 'nowrap',
    ...extra,
  }
}
