# Arrow Rendering & Scale Bar Design

**Date:** 2026-05-10  
**Status:** Approved

## Overview

Replace the current `LineLayer` vector rendering with true arrows (shaft + arrowhead) whose length and color both reflect the actual overlay vector magnitude. Add a scale bar in the bottom-left corner of the map.

## Requirements

1. **Arrow shape:** Each overlay vector rendered as a solid polygon (shaft + arrowhead), not a line.
2. **Arrow length:** 1:1 with vector magnitude in mm (`sqrt(ovlX² + ovlY²)`).
3. **Arrow color:** Viridis colormap keyed on magnitude, using the same `colorMin`/`colorMax` as the scatter points.
4. **Scale bar:** Bottom-left HTML overlay, style B (horizontal bar with tick marks at each end), units in mm, dynamically updates with zoom.

## Arrow Geometry

Each arrow is a 7-vertex polygon:
- **Shaft:** A thin rectangle aligned to the vector direction, width = `0.03 mm`.
- **Arrowhead:** An isoceles triangle at the target end, base width = `0.09 mm`, height = 25% of total arrow length.
- Vertices are computed in `colormap.ts` by rotating a canonical up-pointing arrow by the vector's angle.

```
       ▲
      /|\
     / | \
    /  |  \   ← arrowhead (width = shaft × 3)
   /   |   \
       |        ← shaft (width = 0.03mm, length = mag × 0.75)
       |
    [origin]
```

## Data Flow Changes

### `colormap.ts`

- **Remove:** `arrowSources`, `arrowTargets` from `WaferArrays`.
- **Add:** `arrowPolygons: Array<{ polygon: number[][], color: [number,number,number,number] }>` — computed once from raw data, magnitude, and colorMin/colorMax.
- **New function:** `buildArrowPolygons(data, colorMin, colorMax): ArrowPolygon[]` — combines geometry + color in one pass.

### `App.tsx`

- Pass `arrowPolygons` to `WaferMapView` instead of `arrowSources`/`arrowTargets`.
- Recompute `arrowPolygons` when `data`, `colorMin`, or `colorMax` changes.

### `WaferMapView.tsx`

- Remove `arrowSources`, `arrowTargets` from props.
- Add `arrowPolygons` prop.
- Replace `LineLayer` with `SolidPolygonLayer` using `getPolygon` and `getFillColor` from each entry.

## Scale Bar

**Implementation:** Pure HTML `<div>` overlay, placed as a child of the DeckGL component.

**Zoom-to-pixel mapping:** `pixelsPerMm = 2^zoom` (OrthographicView world units = mm).

**Nice number selection:** Given a target bar width of ~100px, compute `rawMm = 100 / pixelsPerMm`, then round to the nearest value in `[0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]`.

**Appearance:**
```
|————————————————|
       10 mm
```
- Horizontal line with vertical tick marks at each end (style B).
- Label centered below.
- Positioned: `bottom: 24px, left: 16px`, `pointerEvents: none`.

## Files Changed

| File | Change |
|------|--------|
| `src/utils/colormap.ts` | Add `buildArrowPolygons`, remove arrow source/target logic |
| `src/App.tsx` | Pass `arrowPolygons` prop, remove arrowSources/arrowTargets |
| `src/components/WaferMapView.tsx` | Replace `LineLayer` with `SolidPolygonLayer`, add scale bar overlay |

## Out of Scope

- Arrow LOD (arrows already only show above zoom threshold — unchanged).
- Backend changes.
- Changes to color bar or die info panel.
