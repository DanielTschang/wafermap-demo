# Wafer Overlay Visualization POC — Design Spec

**Date:** 2026-05-06  
**Stack:** Spring Boot (Java) + React (Vite) + deck.gl

---

## Overview

A POC web application that visualizes semiconductor wafer overlay data. The backend generates mock measurement data (500k–1M points) and serves it as a binary stream. The frontend renders all points on a wafer map using WebGL, with color coding by overlay magnitude, adjustable color bar, zoom/pan, level-of-detail arrows, and per-die inspection.

---

## Data Model

Each measurement point has 6 fields:

| Field | Type | Description |
|-------|------|-------------|
| `interX` | float32 | X coordinate of the die center (inter-die, mm) |
| `interY` | float32 | Y coordinate of the die center (inter-die, mm) |
| `intraX` | float32 | X offset within the die (intra-die, mm) |
| `intraY` | float32 | Y offset within the die (intra-die, mm) |
| `ovlX` | float32 | Overlay vector X component (nm) |
| `ovlY` | float32 | Overlay vector Y component (nm) |

**Absolute position** of a point: `(interX + intraX, interY + intraY)`

**Overlay magnitude:** `|ovl| = √(ovlX² + ovlY²)` (nm)

**Wire format:** interleaved Float32Array, 6 floats per point, little-endian.  
100万点 = 6 × 4B × 1,000,000 = **24 MB**

---

## Backend

### Technology
- Spring Boot 3.x (Java 17+)
- Single REST controller, no database

### Endpoint

```
GET /api/wafer-data?points=500000
Content-Type: application/octet-stream
```

Response body: raw binary Float32Array in interleaved format:
```
[interX₀, interY₀, intraX₀, intraY₀, ovlX₀, ovlY₀,
 interX₁, interY₁, intraX₁, intraY₁, ovlX₁, ovlY₁, ...]
```

### Mock Data Generator

- Wafer: circular boundary, radius = 150 mm
- Die grid: 20×20 dies, each die 14mm × 14mm
- Only dies within the circular wafer boundary are included
- Each die contains a configurable number of intra-die points, randomly distributed within the die area
- `ovlX`, `ovlY`: Gaussian noise centered at a per-die mean (simulates systematic + random overlay error)
- CORS: allow `http://localhost:5173` (Vite dev server)

### Key Classes

```
WaferDataController      GET /api/wafer-data → byte[]
MockWaferDataGenerator   generates Float32Array binary
WaferDataConfig          configurable params (point count, die size, wafer radius)
```

---

## Frontend

### Technology
- React 18 + Vite
- deck.gl 9.x (`@deck.gl/react`, `@deck.gl/layers`)
- axios (`responseType: 'arraybuffer'`)
- d3-scale-chromatic (colormap: `interpolateViridis`)

### Component Tree

```
App
├── useWaferData()          async fetch + Float32Array parse
├── WaferMapView            deck.gl canvas, handles zoom/pan/click
│   ├── ScatterplotLayer    colored points (always visible)
│   └── LineLayer           overlay arrows (zoom ≥ 5 only)
├── ColorBar                gradient display + min/max range sliders
└── DieInfoPanel            selected die statistics
```

### UI Layout

Right-panel layout:
- **Main area (left):** WaferMapView fills remaining space
- **Right panel (180px):** ColorBar on top, DieInfoPanel in middle, display options at bottom

### WaferMapView

- Coordinate system: world coordinates in mm (interX + intraX, interY + intraY)
- Circular wafer boundary rendered as a background SVG overlay or deck.gl `PolygonLayer`
- `ScatterplotLayer` input: Float32Array passed directly as binary attribute for GPU efficiency
- Point color: mapped from `|ovl|` via Viridis colormap, clamped to `[colorMin, colorMax]`
- Point radius: `radiusUnits: 'meters'`, radius ~0.05 mm — points grow with zoom, becoming individually visible at high zoom; `radiusMinPixels: 1` prevents disappearing at overview zoom
- Click: identifies the die at the clicked point via `interX`/`interY` grouping, triggers `onDieClick`

### Level-of-Detail (LOD) — Arrows

- Monitored via `onViewStateChange` callback
- `zoom < 5`: only `ScatterplotLayer` active
- `zoom ≥ 5`: `LineLayer` also active, each point renders a short line from `(x, y)` in the direction of `(ovlX, ovlY)`, scaled to a fixed screen-space length (e.g., 20px regardless of zoom), direction normalized from `(ovlX, ovlY)`
- At high zoom, only points within the current viewport bounding box are passed to `LineLayer` to maintain performance

### ColorBar

- Horizontal gradient: Viridis from `colorMin` to `colorMax`
- Two sliders: min value and max value (in nm), constrained so min < max
- Labels: numeric values with `nm` unit
- State lifted to `App`, shared with `WaferMapView` for live re-coloring (no re-fetch needed)

### DieInfoPanel

Displayed after clicking a die. Shows:
- Die index (interX, interY)
- Number of measurement points in the die
- Mean `|ovl|` (nm)
- Max `|ovl|` (nm)
- Mean `ovlX`, mean `ovlY` (signed, shows systematic direction)

Statistics computed client-side from the loaded Float32Array by filtering points matching the clicked `interX`/`interY`.

### Data Loading

```
App mounts
  → axios.get('/api/wafer-data?points=500000', { responseType: 'arraybuffer' })
  → new Float32Array(response.data)
  → stored in useRef (stable reference for deck.gl layers)
  → loading spinner while fetching
  → error state if fetch fails
```

No pagination, no streaming — full binary load on startup.

---

## Color Mapping Algorithm

```js
import { interpolateViridis } from 'd3-scale-chromatic'

function ovlMagnitude(ovlX, ovlY) {
  return Math.sqrt(ovlX * ovlX + ovlY * ovlY)
}

function magnitudeToColor(mag, colorMin, colorMax) {
  const t = Math.max(0, Math.min(1, (mag - colorMin) / (colorMax - colorMin)))
  // interpolateViridis returns "rgb(r,g,b)" string — parse to [r,g,b,255]
  return parseViridisRgb(interpolateViridis(t))
}
```

Colors are pre-computed into a `Uint8Array` (RGBA) and passed to `ScatterplotLayer` as a binary color attribute to avoid per-frame JS computation.

---

## Project Structure

```
wafermap-demo/
├── backend/                   Spring Boot project
│   └── src/main/java/
│       └── com/example/wafermap/
│           ├── WafermapApplication.java
│           ├── controller/WaferDataController.java
│           ├── service/MockWaferDataGenerator.java
│           └── config/CorsConfig.java
└── frontend/                  Vite + React project
    └── src/
        ├── App.jsx
        ├── hooks/useWaferData.js
        ├── components/
        │   ├── WaferMapView.jsx
        │   ├── ColorBar.jsx
        │   └── DieInfoPanel.jsx
        └── utils/colormap.js
```

---

## Out of Scope (POC)

- Authentication / authorization
- Real data file ingestion (CSV, HDF5)
- Server-side spatial queries or viewport culling
- Multiple wafer comparison
- Data export
- Unit tests (POC only)
