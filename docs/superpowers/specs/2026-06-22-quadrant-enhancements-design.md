# Quadrant Chart Enhancements — Design Spec
Date: 2026-06-22

## Overview

Add three enhancements to `QuadrantView`:
1. **Pan lock** — X/Y axes always fixed at screen center (world origin always centered)
2. **Axis input + gridlines** — integer gridlines ±1…±N with data clipping beyond ±N
3. **Spec rectangle** — red rectangle drawn at ±specX / ±specY
4. **Floating control panel** — inputs inside QuadrantView (no sidebar changes)

Only `frontend/src/components/QuadrantView.tsx` is modified.

---

## Feature 1: Pan Lock

### Current behaviour
DeckGL uses `initialViewState` (uncontrolled). The user can pan freely, moving the world origin away from the screen center.

### New behaviour
Switch to controlled `viewState`. In `onViewStateChange`, force `target` back to `[0, 0, 0]` on every update, only propagating zoom:

```ts
onViewStateChange={({ viewState }) => {
  setVs(prev => ({ ...prev, zoom: (viewState as ViewState).zoom }))
}}
```

Axis lines (and gridlines) are therefore always at `w/2` and `h/2` in screen space — no need to subtract `target` from the origin computation.

### Simplification to axis math
Because `target` is always `[0,0,0]`, the screen-pixel formula for world coordinate `p` simplifies to:
```
screenX(p) = w/2 + p × scale
screenY(p) = h/2 - p × scale    (Y flipped)
```
where `scale = 2^zoom`.

---

## Feature 2: Axis Input, Gridlines, and Data Clipping

### State
```ts
const [axis, setAxis] = useState<number>(20)   // default 20 nm
```
When the input is empty or 0, no clipping is applied and gridlines are hidden.

### Data clipping (CPU-side)
`useMemo` keyed on `[data, axis]`. Scans the Float32Array linearly and keeps only records where `|ovlX| ≤ axis && |ovlY| ≤ axis`:

```ts
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
```

`clippedData` (not `data`) is passed to the `ScatterplotLayer`. The layer's `useMemo` key also includes `axis`.

### Gridlines
For `i = 1, 2, …, axis` (integer steps), render:
- **Vertical lines** at world X = +i and X = −i:
  ```
  left = w/2 + i × scale   (X = +i)
  left = w/2 - i × scale   (X = −i)
  top: 0, bottom: 0, width: 0
  borderLeft: '1px solid rgba(255,255,255,0.15)'
  ```
- **Horizontal lines** at world Y = +i and Y = −i:
  ```
  top = h/2 - i × scale    (Y = +i, screen Y is flipped)
  top = h/2 + i × scale    (Y = −i)
  left: 0, right: 0, height: 0
  borderTop: '1px solid rgba(255,255,255,0.15)'
  ```
- Each gridline has a small numeric label (`+i` or `−i`, font-size 9px, color `#555`) near its intersection with the opposite axis. X-gridline labels sit just above the X-axis; Y-gridline labels sit just right of the Y-axis.

Grid rendering is done entirely with HTML divs (same pattern as the existing axis lines). No new deck.gl layers.

### Axis input default
Default `axis = 20`. This fits the mock data distribution (die bias σ≈10 nm, noise σ≈3 nm — 3σ ≈ 39 nm total, so 20 nm shows the bulk of the cloud). User may clear the field (treated as "no filter").

---

## Feature 3: Spec Rectangle

### State
```ts
const [specX, setSpecX] = useState<number>(0)
const [specY, setSpecY] = useState<number>(0)
```
When either is 0 or both are 0, no rectangle is drawn.

### Rendering
HTML overlay `<div>` with `position: absolute`, computed from viewState:
```
left   = w/2 - specX × scale
top    = h/2 - specY × scale    (Y flipped — specY > 0 moves up on screen)
width  = 2 × specX × scale
height = 2 × specY × scale
border = 1.5px solid rgba(220, 50, 50, 0.85)
background = rgba(220, 50, 50, 0.05)
pointerEvents = none
```
Visible only when `specX > 0 && specY > 0`.

---

## Feature 4: Floating Control Panel

Small panel, `position: absolute`, top-right corner of the QuadrantView container (`top: 8, right: 8`). Dark semi-transparent background (`rgba(10,10,24,0.85)`), `border-radius: 6px`, `padding: 8px`, `pointerEvents: auto`.

Contains three labeled rows:

| Label  | Input type | Unit |
|--------|-----------|------|
| Axis   | `<input type="number" min="0">` | nm |
| Spec X | `<input type="number" min="0">` | ±nm |
| Spec Y | `<input type="number" min="0">` | ±nm |

Each row: `display: flex`, `align-items: center`, `gap: 6px`. Input `width: 56px`, `font-size: 11px`.

The panel state (`axis`, `specX`, `specY`) lives in `QuadrantView` local state. No changes to `App.tsx` props.

---

## File Changes

| File | Change |
|------|--------|
| `frontend/src/components/QuadrantView.tsx` | All changes — controlled viewState, axis state, specX/specY state, CPU clip, gridlines, spec rect, control panel |

---

## Out of Scope
- Non-integer gridline steps (always 1 nm per step)
- Gridline labels on both ends of each line (one label per gridline, near the axis)
- Saving or exporting control panel values
- Animating viewport to fit ±axis range on zoom
