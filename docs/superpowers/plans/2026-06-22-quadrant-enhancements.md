# Quadrant Chart Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pan lock, axis range gridlines with data clipping, a spec rectangle overlay, and a floating control panel to `QuadrantView`.

**Architecture:** All changes are in `frontend/src/components/QuadrantView.tsx`. Switch DeckGL to controlled `viewState` to lock target at `[0,0,0]`. CPU-side `useMemo` filters data to ±axis nm. HTML `<div>` overlays render N integer gridlines and a ±specX/specY red rectangle, all positioned from the simplified center coords `cx = w/2`, `cy = h/2`. A small floating panel in the top-right corner holds the three number inputs.

**Tech Stack:** React 19, deck.gl v9 (ScatterplotLayer, OrthographicView), TypeScript strict, Vite

---

## File Map

| Action | Path |
|--------|------|
| Modify | `frontend/src/components/QuadrantView.tsx` |

---

### Task 1: Pan lock — controlled viewState + simplified axis math

All work is in `frontend/src/components/QuadrantView.tsx`.

**What changes:**
- `onViewStateChange` stops updating `target` (locked to `[0,0,0]`)
- Axis screen-coords simplify from `originX/originY` to `cx/cy` (both just `w/2`, `h/2`)
- DeckGL switches from `initialViewState` (uncontrolled) to `viewState` (controlled)
- Existing axis line divs updated to use `cx`/`cy`

- [ ] **Step 1: Update `handleViewStateChange` to drop target from state updates**

Replace lines 82–90:
```ts
  const handleViewStateChange = useCallback(
    ({ viewState }: { viewState: Record<string, unknown> }) => {
      setVs({
        zoom: (viewState.zoom as number) ?? INITIAL_VIEW_STATE.zoom,
        target: (viewState.target as [number, number, number]) ?? INITIAL_VIEW_STATE.target,
      })
    },
    [],
  )
```
with:
```ts
  const handleViewStateChange = useCallback(
    ({ viewState }: { viewState: Record<string, unknown> }) => {
      setVs(prev => ({
        ...prev,
        zoom: (viewState.zoom as number) ?? INITIAL_VIEW_STATE.zoom,
      }))
    },
    [],
  )
```

- [ ] **Step 2: Replace `originX`/`originY` with `cx`/`cy`**

Replace lines 49–54:
```ts
  // World origin → screen pixels for axis overlay.
  // OrthographicView: screenX = w/2 + (worldX − targetX) × 2^zoom
  //                   screenY = h/2 − (worldY − targetY) × 2^zoom
  const scale = Math.pow(2, vs.zoom)
  const originX = containerSize.w / 2 - vs.target[0] * scale
  const originY = containerSize.h / 2 + vs.target[1] * scale
```
with:
```ts
  // Target is locked to [0,0,0], so screen position of world point p is:
  // screenX(p) = cx + p × scale
  // screenY(p) = cy - p × scale  (Y is flipped)
  const scale = Math.pow(2, vs.zoom)
  const cx = containerSize.w / 2
  const cy = containerSize.h / 2
```

- [ ] **Step 3: Switch DeckGL to controlled `viewState`**

Replace line 97:
```tsx
        initialViewState={INITIAL_VIEW_STATE}
```
with:
```tsx
        viewState={{ ...INITIAL_VIEW_STATE, zoom: vs.zoom }}
```

- [ ] **Step 4: Update the two axis line divs to use `cx`/`cy`**

Replace lines 103–126:
```tsx
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
```
with:
```tsx
      {/* Main axes — always at screen center because target is locked to [0,0,0] */}
      <div style={{ position: 'absolute', top: cy, left: 0, right: 0, height: 0, borderTop: '1px solid rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', left: cx, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend && npx tsc --noEmit
```
Expected: exit 0, no errors. The `vs.target` field is still used in the `useState` initializer and `viewState` spread — that is fine.

- [ ] **Step 6: Visual check**

Run `npm run dev`, open `http://localhost:5173`. Try panning the quadrant chart — the axes should stay at the center of the viewport. Zoom in/out should still work.

- [ ] **Step 7: Commit**

```bash
git -C /Users/danieltschang/Projects/wafermap-demo add frontend/src/components/QuadrantView.tsx
git -C /Users/danieltschang/Projects/wafermap-demo commit -m "feat: lock quadrant view pan — axes always fixed at screen center"
```

---

### Task 2: Axis state + CPU data clipping

- [ ] **Step 1: Add `axis` state and `clippedData` memo**

After the `const [vs, setVs]` declaration (line 28–31), add:
```ts
  const [axis, setAxis] = useState<number>(20)
```

Then replace the `scale`/`cx`/`cy` block (the one you just updated in Task 1) and everything up to the `layer` useMemo to insert `clippedData`. After the line `const cy = containerSize.h / 2`, add:

```ts
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
```

- [ ] **Step 2: Update the `layer` useMemo to use `clippedData`**

Replace the existing `layer` useMemo (which references `data`):
```ts
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
```
with:
```ts
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
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git -C /Users/danieltschang/Projects/wafermap-demo add frontend/src/components/QuadrantView.tsx
git -C /Users/danieltschang/Projects/wafermap-demo commit -m "feat: add axis state and CPU data clipping to QuadrantView"
```

---

### Task 3: Integer gridlines

- [ ] **Step 1: Add `Fragment` to the React import**

Change line 1 from:
```ts
import { useState, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
```
to:
```ts
import { useState, useLayoutEffect, useRef, useMemo, useCallback, Fragment } from 'react'
```

- [ ] **Step 2: Add `gridIndices` derivation before the return**

After `handleViewStateChange` (and before the `return`), add:
```ts
  // Integer indices 1…axis for gridline rendering
  const gridIndices = axis > 0 ? Array.from({ length: Math.floor(axis) }, (_, i) => i + 1) : []
```

- [ ] **Step 3: Insert gridline divs into the JSX**

Inside the outer `<div>`, BEFORE the two main-axis divs, insert:
```tsx
      {/* Gridlines at ±1, ±2, …, ±axis */}
      {gridIndices.map(i => (
        <Fragment key={i}>
          {/* Vertical gridline at X = +i */}
          <div style={{ position: 'absolute', left: cx + i * scale, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ top: cy + 4 })}>{i}</span>
          </div>
          {/* Vertical gridline at X = -i */}
          <div style={{ position: 'absolute', left: cx - i * scale, top: 0, bottom: 0, width: 0, borderLeft: '1px solid rgba(255,255,255,0.15)', pointerEvents: 'none' }}>
            <span style={gridLabelStyle({ top: cy + 4 })}>-{i}</span>
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
```

- [ ] **Step 4: Add `gridLabelStyle` helper below the existing `labelStyle` function**

After the closing `}` of `labelStyle`, add:
```ts
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
```

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Visual check**

With default `axis = 20`, expect 20 gridlines each side of each axis (80 gridlines total). Each should have a small numeric label. Zoom in: gridlines spread apart. Zoom out: gridlines cluster together. Labels for the X gridlines appear just below the X axis; labels for the Y gridlines appear just right of the Y axis.

- [ ] **Step 7: Commit**

```bash
git -C /Users/danieltschang/Projects/wafermap-demo add frontend/src/components/QuadrantView.tsx
git -C /Users/danieltschang/Projects/wafermap-demo commit -m "feat: add integer gridlines to QuadrantView"
```

---

### Task 4: Spec rectangle overlay

- [ ] **Step 1: Add `specX` and `specY` state**

After `const [axis, setAxis] = useState<number>(20)`, add:
```ts
  const [specX, setSpecX] = useState<number>(0)
  const [specY, setSpecY] = useState<number>(0)
```

- [ ] **Step 2: Add `showSpec` derivation before the return**

After `gridIndices`, add:
```ts
  const showSpec = specX > 0 && specY > 0
```

- [ ] **Step 3: Insert the spec rectangle div into the JSX**

Inside the outer `<div>`, AFTER the two main-axis divs and BEFORE the axis labels, insert:
```tsx
      {/* Spec rectangle: from (−specX, −specY) to (+specX, +specY) in world coords */}
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
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git -C /Users/danieltschang/Projects/wafermap-demo add frontend/src/components/QuadrantView.tsx
git -C /Users/danieltschang/Projects/wafermap-demo commit -m "feat: add spec rectangle overlay to QuadrantView"
```

---

### Task 5: Floating control panel

- [ ] **Step 1: Insert the panel div into the JSX**

At the very end of the outer `<div>`, AFTER the chart title label and BEFORE the closing `</div>`, insert:
```tsx
      {/* Floating control panel — top-right corner */}
      <div style={panelStyle}>
        <label style={rowStyle}>
          <span style={labelTextStyle}>Axis</span>
          <input
            type="number"
            min="0"
            value={axis || ''}
            onChange={e => setAxis(Number(e.target.value))}
            style={inputStyle}
          />
          <span style={unitStyle}>nm</span>
        </label>
        <label style={rowStyle}>
          <span style={labelTextStyle}>Spec X</span>
          <input
            type="number"
            min="0"
            value={specX || ''}
            onChange={e => setSpecX(Number(e.target.value))}
            style={inputStyle}
          />
          <span style={unitStyle}>±nm</span>
        </label>
        <label style={rowStyle}>
          <span style={labelTextStyle}>Spec Y</span>
          <input
            type="number"
            min="0"
            value={specY || ''}
            onChange={e => setSpecY(Number(e.target.value))}
            style={inputStyle}
          />
          <span style={unitStyle}>±nm</span>
        </label>
      </div>
```

- [ ] **Step 2: Add panel style constants at the bottom of the file**

After `gridLabelStyle`, add:
```ts
const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  background: 'rgba(10,10,24,0.85)',
  borderRadius: 6,
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  pointerEvents: 'auto',
  zIndex: 10,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  color: '#aaa',
}

const labelTextStyle: CSSProperties = {
  width: 36,
  textAlign: 'right' as const,
}

const inputStyle: CSSProperties = {
  width: 52,
  fontSize: 11,
  background: '#1a1a2e',
  color: '#e0e0e0',
  border: '1px solid #333',
  borderRadius: 3,
  padding: '1px 4px',
}

const unitStyle: CSSProperties = {
  fontSize: 10,
  color: '#666',
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend && npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Visual verification**

Run `npm run dev`, open `http://localhost:5173`.

Check all of the following:

| Behaviour | Expected |
|-----------|----------|
| Axes position | Always at screen center even when you try to drag/pan |
| Zoom | Still works (scroll/pinch) |
| Axis = 20 (default) | 20 gridlines each side, small numeric labels visible near axis intersections |
| Change Axis to 5 | Gridlines collapse to ±1…±5; data points beyond ±5 nm disappear |
| Change Axis to 0 | Gridlines disappear; all data shown again |
| Spec X = 10, Spec Y = 8 | Red rectangle visible from (−10,−8) to (+10,+8), scales with zoom |
| Spec X = 0 | Rectangle disappears |
| Panel position | Top-right corner of quadrant panel, dark semi-transparent background |

- [ ] **Step 5: Commit**

```bash
git -C /Users/danieltschang/Projects/wafermap-demo add frontend/src/components/QuadrantView.tsx
git -C /Users/danieltschang/Projects/wafermap-demo commit -m "feat: add floating control panel with axis, specX, specY inputs"
```
