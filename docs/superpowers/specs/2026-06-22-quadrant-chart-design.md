# Quadrant Chart Page — Design Spec
Date: 2026-06-22

## Overview

Add a quadrant chart (象限圖) that visualises overlay error distribution. It sits side-by-side with the existing WaferMapView and uses the same `Float32Array` data source, plotting `ovlX` vs `ovlY` for every measurement point.

## Data Flow

Each record in the Float32Array has 6 floats:

| Index | Field   | Description                    |
|-------|---------|-------------------------------|
| 0     | interX  | Die center X (mm)             |
| 1     | interY  | Die center Y (mm)             |
| 2     | intraX  | Intra-die position X (mm)     |
| 3     | intraY  | Intra-die position Y (mm)     |
| 4     | ovlX    | Overlay error X (nm) ← used  |
| 5     | ovlY    | Overlay error Y (nm) ← used  |

`App.tsx` already holds `data: Float32Array | null` from `useWaferData`. This reference is passed directly to `QuadrantView` — no new fetch, no new hook.

## Rendering Approach (Approach A)

Use deck.gl `ScatterplotLayer` with a **strided typed-array attribute**:

```ts
attributes: {
  getPosition: {
    value: data,        // the same Float32Array
    size: 2,
    stride: 24,         // 6 floats × 4 bytes — step over one full record
    offset: 16,         // skip interX, interY, intraX, intraY (4 × 4 bytes)
  }
}
```

deck.gl uploads this to the GPU internally. No new WebGPU compute shader is needed.

**Color**: single static RGBA `[100, 160, 255, 120]` (semi-transparent blue). No `colorBuffer` needed.

**Radius**: fixed small value (e.g. `0.3` nm world units), `radiusMinPixels: 1`, `radiusMaxPixels: 4`.

## QuadrantView Component

File: `frontend/src/components/QuadrantView.tsx`

Props:
```ts
interface QuadrantViewProps {
  data: Float32Array | null
}
```

Internals:
- `DeckGL` with `OrthographicView`, same pan/zoom controller as WaferMapView
- Initial view state centred at `[0, 0]`, zoom chosen to fit ~±50 nm range
- `onViewStateChange` tracked in state to recompute axis overlay positions
- HTML overlay for axes (see below)

## Axis Overlay

Absolute-positioned `<div>` children inside the DeckGL container:

- **X axis line**: horizontal `<div>` at the Y=0 screen position, full width, 1px `border-top`
- **Y axis line**: vertical `<div>` at the X=0 screen position, full height, 1px `border-left`
- **Quadrant labels**: four corner labels (Q1–Q4 or `(+,+)` style)
- **Axis labels**: small "ovlX (nm)" and "ovlY (nm)" labels near each axis end

The screen position of the world origin `[0, 0]` is computed each render via `viewport.project([0, 0, 0])` inside the DeckGL `onAfterRender` callback (or derived from viewState). Lines are clamped to the visible canvas so they don't disappear on pan.

## Layout Changes

### App.tsx

- Import `QuadrantView`
- Render it inside a new `.main-area` wrapper alongside `WaferMapView`
- Pass `data={data}` to QuadrantView (QuadrantView handles `data === null` gracefully by rendering nothing)

### App.css

Current layout:
```
.layout  →  flex-row: [.map-area | .sidebar]
```

New layout:
```
.layout  →  flex-row: [.main-area | .sidebar]
  .main-area  →  flex-row: [.map-area (flex:1) | .quadrant-area (flex:1)]
```

Both `.map-area` and `.quadrant-area` take equal horizontal space. `.sidebar` keeps its fixed width.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/components/QuadrantView.tsx` | New component |
| `frontend/src/App.tsx` | Import QuadrantView, add `.main-area` wrapper, pass `data` |
| `frontend/src/App.css` | Add `.main-area`, `.quadrant-area` styles |

## Out of Scope

- Interaction between QuadrantView and WaferMapView (independent, no cross-highlight)
- Per-die aggregation / die-level averaging
- Axis tick marks with numeric labels (plain quadrant lines only)
- Color mapping by overlay magnitude
