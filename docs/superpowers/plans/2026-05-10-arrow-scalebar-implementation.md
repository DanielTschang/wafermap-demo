# Arrow Rendering & Scale Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed-length white line vectors with magnitude-scaled colored arrow polygons, and add a scale bar overlay in the bottom-left corner.

**Architecture:** `buildArrowPolygons` in `colormap.ts` pre-computes 7-vertex solid polygons (shaft + arrowhead) for each point, combining geometry and Viridis color in one pass. `WaferMapView` renders them with `SolidPolygonLayer` and adds a pure-HTML scale bar overlay. `App.tsx` wires the new data flow.

**Tech Stack:** React 18, deck.gl `SolidPolygonLayer`, d3-scale-chromatic (Viridis), TypeScript

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/utils/colormap.ts` | Add `ArrowPolygon` interface, `buildArrowPolygons`, remove arrow source/target from `WaferArrays` |
| `frontend/src/App.tsx` | Replace `arrowSources`/`arrowTargets` with `arrowPolygons` memo and prop |
| `frontend/src/components/WaferMapView.tsx` | Replace `LineLayer` with `SolidPolygonLayer`, add scale bar HTML overlay |

---

## Task 1: Update `colormap.ts` — Arrow polygon geometry and color

**Files:**
- Modify: `frontend/src/utils/colormap.ts`

**Context:**
- Overlay values `ovlX`/`ovlY` are in **nm**. Map coordinates are in **mm**.
- `VECTOR_SCALE_MM_PER_NM = 0.01` makes a 50 nm overlay → 0.5 mm arrow (proportional to magnitude).
- Arrow polygon: 7 vertices tracing shaft (thin rectangle) + arrowhead (triangle). Rotated to align with the vector direction.
- Rotation math: canonical up-arrow `(px, py)` → world `(x + px·dy + py·dx, y − px·dx + py·dy)` where `dx = ovlX/mag`, `dy = ovlY/mag`.

- [ ] **Step 1: Replace `colormap.ts` entirely with the updated version**

```typescript
import { interpolateViridis } from 'd3-scale-chromatic'

const VECTOR_SCALE_MM_PER_NM = 0.01
const SHAFT_WIDTH_MM         = 0.03
const HEAD_WIDTH_MM          = 0.09
const HEAD_LENGTH_RATIO      = 0.25

export interface ArrowPolygon {
  polygon: number[][]
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

    // Rotate canonical (px, py) to world coords.
    // Canonical +Y maps to (dx, dy). Result: [wx, wy]
    const r = (px: number, py: number): [number, number] => [
      x + px * dy + py * dx,
      y - px * dx + py * dy,
    ]

    const polygon: number[][] = [
      r(-sw, 0),
      r(-sw, shaftLen),
      r(-hw, shaftLen),
      r(  0, shaftLen + headLen),
      r( hw, shaftLen),
      r( sw, shaftLen),
      r( sw, 0),
    ]

    const t = Math.max(0, Math.min(1, (mag - colorMin) / range))
    const color = parseViridisColor(interpolateViridis(t))

    polygons.push({ polygon, color })
  }

  return polygons
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors relating to `colormap.ts`. (Downstream errors in `App.tsx` / `WaferMapView.tsx` are expected — fix in later tasks.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/colormap.ts
git commit -m "feat: replace arrow line data with SolidPolygonLayer arrow geometry"
```

---

## Task 2: Update `App.tsx` — Wire `arrowPolygons` data flow

**Files:**
- Modify: `frontend/src/App.tsx`

**Context:**
- `WaferArrays` no longer contains `arrowSources`/`arrowTargets` — remove those from destructuring.
- `arrowPolygons` depends on `data`, `colorMin`, `colorMax` — recomputes whenever any changes.

- [ ] **Step 1: Replace `App.tsx` entirely with the updated version**

```tsx
import './App.css'
import { useState, useMemo } from 'react'
import { useWaferData }                                         from './hooks/useWaferData.ts'
import type { FieldParams }                                     from './hooks/useWaferData.ts'
import { prepareWaferArrays, buildColorArray, buildArrowPolygons } from './utils/colormap.ts'
import WaferMapView                                             from './components/WaferMapView.tsx'
import ColorBar                                                 from './components/ColorBar.tsx'
import DieInfoPanel                                             from './components/DieInfoPanel.tsx'
import type { SelectedDie }                                     from './components/DieInfoPanel.tsx'
import FieldParamsPanel                                         from './components/FieldParamsPanel.tsx'

const DEFAULT_FIELD_PARAMS: FieldParams = {
  fieldSizeX: 25.8,
  fieldSizeY: 32.5,
  fieldOffsetX: 0,
  fieldOffsetY: 6.101,
}

export default function App() {
  const [colorMin, setColorMin]       = useState(0)
  const [colorMax, setColorMax]       = useState(50)
  const [selectedDie, setSelectedDie] = useState<SelectedDie | null>(null)
  const [fieldParams, setFieldParams] = useState<FieldParams>(DEFAULT_FIELD_PARAMS)

  const { data, loading, error } = useWaferData(500000, fieldParams)

  const waferArrays = useMemo(() => {
    if (!data) return null
    return prepareWaferArrays(data)
  }, [data])

  const colors = useMemo(() => {
    if (!data) return null
    return buildColorArray(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  const arrowPolygons = useMemo(() => {
    if (!data) return null
    return buildArrowPolygons(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  if (loading) return <div className="status">Loading wafer data…</div>
  if (error)   return <div className="status error">Error: {error}</div>
  if (!waferArrays || !colors || !arrowPolygons) return null

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={waferArrays.n}
          positions={waferArrays.positions}
          colors={colors}
          arrowPolygons={arrowPolygons}
          data={data!}
          fieldParams={fieldParams}
          onDieClick={setSelectedDie}
        />
      </div>
      <div className="sidebar">
        <ColorBar
          colorMin={colorMin}
          colorMax={colorMax}
          onMinChange={setColorMin}
          onMaxChange={setColorMax}
        />
        <FieldParamsPanel params={fieldParams} onApply={setFieldParams} />
        <DieInfoPanel selectedDie={selectedDie} data={data!} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: only errors in `WaferMapView.tsx` (old props mismatch). No errors in `App.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: pass arrowPolygons from buildArrowPolygons to WaferMapView"
```

---

## Task 3: Update `WaferMapView.tsx` — Replace `LineLayer` with `SolidPolygonLayer`

**Files:**
- Modify: `frontend/src/components/WaferMapView.tsx`

**Context:**
- Remove `arrowSources`, `arrowTargets` from props interface.
- Add `arrowPolygons: ArrowPolygon[]` to props.
- Replace the `LineLayer` import with `SolidPolygonLayer` (both from `@deck.gl/layers`).
- `SolidPolygonLayer` accepts `getPolygon` and `getFillColor` accessors per datum.

- [ ] **Step 1: Replace `WaferMapView.tsx` entirely with the updated version**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles with zero errors**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify arrows appear**

```bash
cd frontend && npm run dev
```

Open browser at `http://localhost:5173`. Zoom in past zoom level 5. Expected: colored arrow polygons appear on the wafer, each pointing in the overlay vector direction, with color matching the corresponding scatter point color.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WaferMapView.tsx
git commit -m "feat: render overlay vectors as colored arrow polygons with SolidPolygonLayer"
```

---

## Task 4: Add scale bar overlay to `WaferMapView.tsx`

**Files:**
- Modify: `frontend/src/components/WaferMapView.tsx`

**Context:**
- OrthographicView zoom formula: `pixelsPerMm = 2^zoom` (world unit = 1 mm).
- Target bar width: ~100 screen pixels. Pick the nearest "nice" mm value from a lookup table.
- Style B: horizontal bar with vertical tick marks at left and right ends (U-shape open at top), label centered below.

- [ ] **Step 1: Add `niceScaleBar` helper and styles above the component export**

Add this code at the top of `WaferMapView.tsx`, after the imports and constants:

```tsx
const NICE_MM_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]

function niceScaleBar(zoom: number): { widthPx: number; labelMm: number } {
  const pixelsPerMm = Math.pow(2, zoom)
  const rawMm = 100 / pixelsPerMm
  const niceMm = NICE_MM_STEPS.find(s => s >= rawMm) ?? NICE_MM_STEPS[NICE_MM_STEPS.length - 1]
  return { widthPx: Math.round(niceMm * pixelsPerMm), labelMm: niceMm }
}
```

- [ ] **Step 2: Add scale bar JSX inside the `DeckGL` children, alongside the zoom badge**

Inside the `return (...)` block of `WaferMapView`, add the scale bar `<div>` as a sibling to the existing zoom badge `<div>`:

```tsx
    <DeckGL ...>
      <div style={zoomBadgeStyle}>
        zoom {zoom.toFixed(1)} {showArrows ? '· arrows on' : ''} · {dieBoundaries.length} dies
      </div>
      <ScaleBar zoom={zoom} />
    </DeckGL>
```

Add `ScaleBar` as a local component at the bottom of the file (before the style constants):

```tsx
function ScaleBar({ zoom }: { zoom: number }) {
  const { widthPx, labelMm } = niceScaleBar(zoom)
  return (
    <div style={scaleBarContainerStyle}>
      <div style={{ ...scaleBarLineStyle, width: widthPx }} />
      <div style={scaleBarLabelStyle}>
        {labelMm >= 1 ? `${labelMm} mm` : `${labelMm * 1000} μm`}
      </div>
    </div>
  )
}

const scaleBarContainerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 24,
  left: 16,
  pointerEvents: 'none',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

const scaleBarLineStyle: React.CSSProperties = {
  height: 8,
  borderLeft: '2px solid #aaa',
  borderRight: '2px solid #aaa',
  borderBottom: '2px solid #aaa',
  boxSizing: 'border-box',
}

const scaleBarLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#aaa',
  marginTop: 2,
  whiteSpace: 'nowrap',
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Test scale bar behavior in browser**

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`. Check:
1. Scale bar is visible at bottom-left with tick marks on both ends.
2. Zooming in makes the label smaller (e.g., `0.5 mm` → `0.2 mm` → `0.1 mm` → `100 μm`).
3. Zooming out makes the label larger (e.g., `10 mm` → `50 mm` → `200 mm`).
4. Bar width stays roughly 100px regardless of zoom.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/WaferMapView.tsx
git commit -m "feat: add scale bar overlay with dynamic nice-number mm labels"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Arrows rendered as solid polygons (Task 1, 3)
  - ✅ Arrow length 1:1 proportional to magnitude via `VECTOR_SCALE_MM_PER_NM` (Task 1)
  - ✅ Arrow color = Viridis by magnitude with same colorMin/colorMax (Task 1)
  - ✅ Scale bar bottom-left, style B (tick marks), mm units (Task 4)
- **No placeholders:** All steps include complete code.
- **Type consistency:** `ArrowPolygon` defined in Task 1, imported in Tasks 2 and 3. `buildArrowPolygons` signature matches usage in `App.tsx`.
- **Backwards compat:** `buildColorArray` and `prepareWaferArrays` signatures unchanged.
