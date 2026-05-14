import {useState, useRef, useMemo, useCallback} from 'react'
import DeckGL from '@deck.gl/react'
import {OrthographicView} from '@deck.gl/core'
import {ScatterplotLayer, SolidPolygonLayer, PathLayer, LineLayer} from '@deck.gl/layers'
import type {PickingInfo} from '@deck.gl/core'
import type {SelectedDie} from './DieInfoPanel.tsx'
import type {FieldParams} from '../hooks/useWaferData.ts'
import type {GpuBuffers} from '../hooks/useGpuCompute.ts'
import {ArrowLayer} from '../layers/ArrowLayer.ts'
import {setDevice} from '../gpu/webgpuDevice.ts'

const WAFER_RADIUS = 150
const GRID_HALF    = 10
const LOD_ZOOM_THRESHOLD = 5

const WAFER_RING = (() => {
  const steps = 128
  return Array.from({length: steps + 1}, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI
    return [Math.cos(angle) * WAFER_RADIUS, Math.sin(angle) * WAFER_RADIUS]
  })
})()

const WAFER_FILLED = [{polygon: WAFER_RING.slice(0, -1)}]
const WAFER_PATH   = [{path: WAFER_RING}]

const NICE_MM_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]

function niceScaleBar(zoom: number): {widthPx: number; labelMm: number} {
  const pixelsPerMm = Math.pow(2, zoom)
  const rawMm = 100 / pixelsPerMm
  const niceMm = NICE_MM_STEPS.find(s => s >= rawMm) ?? NICE_MM_STEPS[NICE_MM_STEPS.length - 1]
  return {widthPx: Math.round(niceMm * pixelsPerMm), labelMm: niceMm}
}

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0] as [number, number, number],
  zoom: 1.7,
  minZoom: -2,
  maxZoom: 14,
}

interface WaferMapViewProps {
  n: number
  gpuBuffers: GpuBuffers | null
  data: Float32Array | null
  fieldParams: FieldParams
  onDieClick: (die: SelectedDie) => void
  onDeviceReady: () => void
}

export default function WaferMapView({n, gpuBuffers, data, fieldParams, onDieClick, onDeviceReady}: WaferMapViewProps) {
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deckRef = useRef<any>(null)
  const deviceCapturedRef = useRef(false)

  const handleClick = useCallback((info: PickingInfo): void => {
    if (info.index == null || info.index < 0 || !data) return
    const i = info.index
    onDieClick({interX: data[i * 6], interY: data[i * 6 + 1]})
  }, [data, onDieClick])

  const dieBoundaries = useMemo(() => {
    const {fieldSizeX, fieldSizeY, fieldOffsetX, fieldOffsetY} = fieldParams
    const halfDiag = Math.sqrt(fieldSizeX ** 2 + fieldSizeY ** 2) / 2
    const threshold = WAFER_RADIUS - halfDiag
    const hx = fieldSizeX / 2
    const hy = fieldSizeY / 2
    const lines: {sourcePosition: number[]; targetPosition: number[]}[] = []
    for (let ix = -GRID_HALF; ix <= GRID_HALF; ix++) {
      for (let iy = -GRID_HALF; iy <= GRID_HALF; iy++) {
        const cx = ix * fieldSizeX + fieldOffsetX
        const cy = iy * fieldSizeY + fieldOffsetY
        if (Math.sqrt(cx * cx + cy * cy) <= threshold) {
          const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy
          lines.push(
            {sourcePosition: [x0, y0], targetPosition: [x1, y0]},
            {sourcePosition: [x1, y0], targetPosition: [x1, y1]},
            {sourcePosition: [x1, y1], targetPosition: [x0, y1]},
            {sourcePosition: [x0, y1], targetPosition: [x0, y0]},
          )
        }
      }
    }
    return lines
  }, [fieldParams])

  const showArrows = zoom >= LOD_ZOOM_THRESHOLD

  // Capture the device DeckGL created on first render, store in singleton for compute shaders
  const handleAfterRender = useCallback(() => {
    if (deviceCapturedRef.current) return
    const device = deckRef.current?.deck?.device
    if (device) {
      setDevice(device)
      deviceCapturedRef.current = true
      onDeviceReady()
    }
  }, [onDeviceReady])

  const layers = useMemo(() => {
    const base = [
      new SolidPolygonLayer({
        id: 'wafer-fill',
        data: WAFER_FILLED,
        getPolygon: (d: {polygon: number[][]}) => d.polygon as any,
        getFillColor: [20, 20, 40, 200] as [number, number, number, number],
        filled: true,
      }),

      new PathLayer({
        id: 'wafer-outline',
        data: WAFER_PATH,
        getPath: (d: {path: number[][]}) => d.path as any,
        getColor: [80, 120, 200, 180] as [number, number, number, number],
        getWidth: 1,
        widthUnits: 'pixels' as const,
      }),

      new LineLayer({
        id: 'die-boundaries',
        data: dieBoundaries,
        getSourcePosition: (d: {sourcePosition: number[]}) => d.sourcePosition as [number, number],
        getTargetPosition: (d: {targetPosition: number[]}) => d.targetPosition as [number, number],
        getColor: [100, 100, 160, 160] as [number, number, number, number],
        getWidth: 0.5,
        widthUnits: 'pixels' as const,
      }),
    ]

    if (!gpuBuffers) return base

    return [
      ...base,
      new ScatterplotLayer({
        id: 'points',
        data: {
          length: n,
          attributes: {
            getPosition: {buffer: gpuBuffers.positionBuffer, size: 2},
            getFillColor: {buffer: gpuBuffers.colorBuffer,   size: 4, type: 'uint8', normalized: true},
          },
        },
        getRadius: 0.08,
        radiusMinPixels: 1,
        radiusMaxPixels: 6,
        pickable: true,
        onClick: handleClick,
      }),

      new ArrowLayer({
        id: 'arrows',
        visible: showArrows,
        vertexBuffer: gpuBuffers.arrowVertexBuffer,
        colorBuffer:  gpuBuffers.arrowColorBuffer,
        vertexCount:  gpuBuffers.arrowVertexCount,
        pickable: false,
      }),
    ]
  }, [n, gpuBuffers, dieBoundaries, showArrows, handleClick])

  return (
    <DeckGL
      ref={deckRef}
      device={{type: 'webgpu'} as any}
      views={new OrthographicView({id: 'main'})}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      onAfterRender={handleAfterRender}
      onViewStateChange={({viewState}) => {
        const vs = viewState as {zoom: number}
        setZoom(vs.zoom)
      }}
      style={{position: 'relative', width: '100%', height: '100%'}}
    >
      <div style={zoomBadgeStyle}>
        zoom {zoom.toFixed(1)} {showArrows ? '· arrows on' : ''} · {dieBoundaries.length / 4} dies
      </div>
      <ScaleBar zoom={zoom} />
    </DeckGL>
  )
}

function ScaleBar({zoom}: {zoom: number}) {
  const {widthPx, labelMm} = niceScaleBar(zoom)
  return (
    <div style={scaleBarContainerStyle}>
      <div style={{...scaleBarLineStyle, width: widthPx}} />
      <div style={scaleBarLabelStyle}>
        {labelMm >= 1 ? `${labelMm} mm` : `${labelMm * 1000} μm`}
      </div>
    </div>
  )
}

const scaleBarContainerStyle: React.CSSProperties = {
  position: 'absolute', bottom: 24, left: 16, pointerEvents: 'none',
  display: 'flex', flexDirection: 'column', alignItems: 'center',
}
const scaleBarLineStyle: React.CSSProperties = {
  height: 8, borderLeft: '2px solid #aaa', borderRight: '2px solid #aaa',
  borderBottom: '2px solid #aaa', boxSizing: 'border-box',
}
const scaleBarLabelStyle: React.CSSProperties = {
  fontSize: 10, color: '#aaa', marginTop: 2, whiteSpace: 'nowrap',
}
const zoomBadgeStyle: React.CSSProperties = {
  position: 'absolute', bottom: 8, left: 8, fontSize: 10, color: '#555', pointerEvents: 'none',
}
