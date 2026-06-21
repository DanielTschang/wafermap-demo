# Quadrant Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `QuadrantView` component that plots all 500 K measurement points with ovlX on the X-axis and ovlY on the Y-axis, displayed side-by-side with the existing WaferMapView.

**Architecture:** A new `QuadrantView` component receives the same `Float32Array` already loaded in `App.tsx` and feeds it to a deck.gl `ScatterplotLayer` using a strided typed-array attribute (stride=24, offset=16) to read only the ovlX/ovlY fields without any GPU compute shader. HTML `<div>` elements overlaid on the DeckGL canvas draw the two axis lines. `App.tsx` wraps both views in a new `.main-area` flex row.

**Tech Stack:** React 19, deck.gl v9 (`ScatterplotLayer`, `OrthographicView`), TypeScript strict, Vite

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/components/QuadrantView.tsx` | New component: scatter + axis overlay |
| Modify | `frontend/src/App.tsx` | Import QuadrantView, add `.main-area` wrapper |
| Modify | `frontend/src/App.css` | Add `.main-area` and `.quadrant-area` styles |

---

### Task 1: Create QuadrantView component

**Files:**
- Create: `frontend/src/components/QuadrantView.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/QuadrantView.tsx` with the full content below:

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors. If you see `'value' does not exist` on the attribute object, add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` above and cast `data as any` — deck.gl v9 types for typed-array attributes are incomplete for stride/offset.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/QuadrantView.tsx
git commit -m "feat: add QuadrantView component with ovlX/Y scatter and axis overlay"
```

---

### Task 2: Update App.css with main-area and quadrant-area styles

**Files:**
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Add new styles**

In `frontend/src/App.css`, replace the existing `.map-area` block:

```css
.map-area {
  flex: 1;
  position: relative;
  background: #0a0a18;
}
```

with:

```css
.main-area {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.map-area {
  flex: 1;
  position: relative;
  background: #0a0a18;
  border-right: 1px solid #1e1e3a;
}

.quadrant-area {
  flex: 1;
  position: relative;
  background: #0a0a18;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.css
git commit -m "style: add main-area and quadrant-area layout styles"
```

---

### Task 3: Wire QuadrantView into App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add import**

At the top of `frontend/src/App.tsx`, after the existing imports, add:

```ts
import QuadrantView      from './components/QuadrantView.tsx'
```

- [ ] **Step 2: Update JSX layout**

In `frontend/src/App.tsx`, replace the JSX return body:

```tsx
  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={gpuBuffers && data ? data.length / 6 : 0}
          gpuBuffers={gpuBuffers}
          data={data}
          fieldParams={fieldParams}
          onDieClick={setSelectedDie}
          onDeviceReady={handleDeviceReady}
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
```

with:

```tsx
  return (
    <div className="layout">
      <div className="main-area">
        <div className="map-area">
          <WaferMapView
            n={gpuBuffers && data ? data.length / 6 : 0}
            gpuBuffers={gpuBuffers}
            data={data}
            fieldParams={fieldParams}
            onDieClick={setSelectedDie}
            onDeviceReady={handleDeviceReady}
          />
        </div>
        <div className="quadrant-area">
          <QuadrantView data={data} />
        </div>
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
```

- [ ] **Step 3: Type-check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Visual verification**

Start the dev server (requires the Spring Boot backend running on port 8080 first):

```bash
cd frontend && npm run dev
```

Open `http://localhost:5173` in Chrome. Verify:

1. Layout shows **Wafer Map on the left**, **Quadrant chart on the right**, sidebar on the far right
2. Quadrant chart shows a **scatter cloud** of points centred roughly at (0, 0)
3. Two axis lines (horizontal and vertical) divide the chart into four quadrants
4. Pan and zoom work independently in both views
5. After zooming the quadrant chart, the axis lines stay aligned with world (0, 0)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: integrate QuadrantView into App layout alongside WaferMapView"
```
