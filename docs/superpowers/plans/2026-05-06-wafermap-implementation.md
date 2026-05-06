# Wafer Overlay Visualization POC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack POC that renders 500k–1M semiconductor wafer overlay points in a browser using WebGL, with color-coded overlay magnitude, adjustable color bar, zoom/pan, LOD arrows, and per-die inspection.

**Architecture:** Spring Boot serves mock binary Float32Array data (24MB for 1M points) via a single REST endpoint. React + deck.gl renders all points on an OrthographicView canvas with a ScatterplotLayer (always) and LineLayer arrows (zoom ≥ 5). Colors are pre-computed client-side into a Uint8Array and passed as a binary GPU attribute.

**Tech Stack:** Java 17, Spring Boot 3.x, Maven · React 18, Vite, deck.gl 9.x, axios, d3-scale-chromatic

---

## File Map

```
wafermap-demo/
├── backend/
│   ├── pom.xml
│   └── src/main/
│       ├── java/com/example/wafermap/
│       │   ├── WafermapApplication.java
│       │   ├── config/CorsConfig.java
│       │   ├── controller/WaferDataController.java
│       │   └── service/MockWaferDataGenerator.java
│       └── resources/application.properties
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx
        ├── App.css
        ├── hooks/useWaferData.js
        ├── utils/colormap.js
        └── components/
            ├── WaferMapView.jsx
            ├── ColorBar.jsx
            └── DieInfoPanel.jsx
```

---

## Task 1: Backend Scaffold

**Files:**
- Create: `backend/pom.xml`
- Create: `backend/src/main/java/com/example/wafermap/WafermapApplication.java`
- Create: `backend/src/main/resources/application.properties`

- [ ] **Step 1: Create the Maven project via Spring Initializr**

```bash
cd /path/to/wafermap-demo
curl -s https://start.spring.io/starter.zip \
  -d type=maven-project \
  -d language=java \
  -d bootVersion=3.2.5 \
  -d groupId=com.example \
  -d artifactId=wafermap \
  -d name=wafermap \
  -d packageName=com.example.wafermap \
  -d javaVersion=17 \
  -d dependencies=web \
  -o backend.zip && \
  unzip backend.zip -d backend && \
  rm backend.zip
```

- [ ] **Step 2: Add `server.port` to application.properties**

`backend/src/main/resources/application.properties`:
```properties
server.port=8080
```

- [ ] **Step 3: Verify the scaffold compiles and starts**

```bash
cd backend
./mvnw spring-boot:run
```

Expected output:
```
Started WafermapApplication in X.XXX seconds
```

Press `Ctrl+C` to stop.

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/
git commit -m "feat: add Spring Boot backend scaffold"
```

---

## Task 2: MockWaferDataGenerator

**Files:**
- Create: `backend/src/main/java/com/example/wafermap/service/MockWaferDataGenerator.java`

Generates a circular wafer (radius=150mm) with a 20×20 die grid (14mm × 14mm per die). Each die gets a Gaussian per-die overlay bias; intra-die points are randomly distributed within the die area. Output: little-endian `byte[]` interleaved as `[interX, interY, intraX, intraY, ovlX, ovlY, ...]` in float32.

- [ ] **Step 1: Create MockWaferDataGenerator.java**

`backend/src/main/java/com/example/wafermap/service/MockWaferDataGenerator.java`:
```java
package com.example.wafermap.service;

import org.springframework.stereotype.Service;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

@Service
public class MockWaferDataGenerator {

    private static final float WAFER_RADIUS = 150f;  // mm
    private static final float DIE_SIZE     = 14f;   // mm
    private static final int   GRID_HALF    = 10;    // ±10 → 20×20 grid

    public byte[] generate(int requestedPoints) {
        List<float[]> dies = validDieCenters();
        int pointsPerDie = Math.max(1, requestedPoints / dies.size());
        int totalPoints  = pointsPerDie * dies.size();

        ByteBuffer buf = ByteBuffer
                .allocate(totalPoints * 6 * Float.BYTES)
                .order(ByteOrder.LITTLE_ENDIAN);

        Random rng = new Random(42);

        for (float[] center : dies) {
            // per-die systematic overlay (Gaussian, σ=10nm)
            float dieOvlX = (float) (rng.nextGaussian() * 10);
            float dieOvlY = (float) (rng.nextGaussian() * 10);

            for (int i = 0; i < pointsPerDie; i++) {
                // random position within die
                float intraX = (rng.nextFloat() - 0.5f) * DIE_SIZE;
                float intraY = (rng.nextFloat() - 0.5f) * DIE_SIZE;
                // overlay = die bias + random noise (σ=3nm)
                float ovlX = dieOvlX + (float) (rng.nextGaussian() * 3);
                float ovlY = dieOvlY + (float) (rng.nextGaussian() * 3);

                buf.putFloat(center[0]) // interX
                   .putFloat(center[1]) // interY
                   .putFloat(intraX)
                   .putFloat(intraY)
                   .putFloat(ovlX)
                   .putFloat(ovlY);
            }
        }

        return buf.array();
    }

    private List<float[]> validDieCenters() {
        List<float[]> centers = new ArrayList<>();
        for (int ix = -GRID_HALF; ix <= GRID_HALF; ix++) {
            for (int iy = -GRID_HALF; iy <= GRID_HALF; iy++) {
                float cx = ix * DIE_SIZE;
                float cy = iy * DIE_SIZE;
                // die is valid if its center fits inside the wafer circle
                if (Math.sqrt(cx * cx + cy * cy) <= WAFER_RADIUS - DIE_SIZE / 2f) {
                    centers.add(new float[]{cx, cy});
                }
            }
        }
        return centers;
    }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd backend
./mvnw compile
```

Expected: `BUILD SUCCESS`

- [ ] **Step 3: Commit**

```bash
cd ..
git add backend/src/main/java/com/example/wafermap/service/
git commit -m "feat: add MockWaferDataGenerator"
```

---

## Task 3: WaferDataController + CorsConfig

**Files:**
- Create: `backend/src/main/java/com/example/wafermap/controller/WaferDataController.java`
- Create: `backend/src/main/java/com/example/wafermap/config/CorsConfig.java`

- [ ] **Step 1: Create WaferDataController.java**

`backend/src/main/java/com/example/wafermap/controller/WaferDataController.java`:
```java
package com.example.wafermap.controller;

import com.example.wafermap.service.MockWaferDataGenerator;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class WaferDataController {

    private final MockWaferDataGenerator generator;

    public WaferDataController(MockWaferDataGenerator generator) {
        this.generator = generator;
    }

    @GetMapping(value = "/wafer-data", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getWaferData(
            @RequestParam(defaultValue = "500000") int points) {
        byte[] data = generator.generate(points);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(data);
    }
}
```

- [ ] **Step 2: Create CorsConfig.java**

`backend/src/main/java/com/example/wafermap/config/CorsConfig.java`:
```java
package com.example.wafermap.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("http://localhost:5173")
                .allowedMethods("GET");
    }
}
```

- [ ] **Step 3: Start the backend and test the endpoint**

```bash
cd backend
./mvnw spring-boot:run &
sleep 8
curl -s -o /dev/null -w "%{http_code} %{size_download} bytes\n" \
  "http://localhost:8080/api/wafer-data?points=1000"
```

Expected output (exact point count varies by die grid):
```
200 XXXX bytes
```

Kill the background server: `kill %1`

- [ ] **Step 4: Commit**

```bash
cd ..
git add backend/src/main/java/com/example/wafermap/controller/ \
        backend/src/main/java/com/example/wafermap/config/
git commit -m "feat: add REST endpoint and CORS config"
```

---

## Task 4: Frontend Scaffold

**Files:**
- Create: `frontend/` (via Vite)

- [ ] **Step 1: Scaffold the Vite + React project**

```bash
npm create vite@latest frontend -- --template react
```

- [ ] **Step 2: Install dependencies**

```bash
cd frontend
npm install
npm install axios d3-scale-chromatic
npm install @deck.gl/core @deck.gl/layers @deck.gl/react
```

- [ ] **Step 3: Clear the default boilerplate**

Replace `frontend/src/App.jsx` with:
```jsx
export default function App() {
  return <div>WaferMap Loading...</div>
}
```

Replace `frontend/src/App.css` with:
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: 'Inter', sans-serif;
  height: 100vh;
  overflow: hidden;
}

#root {
  height: 100vh;
}
```

- [ ] **Step 4: Verify it runs**

```bash
npm run dev
```

Open `http://localhost:5173` — should show "WaferMap Loading...".

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/
git commit -m "feat: add React + Vite frontend scaffold"
```

---

## Task 5: colormap.js Utility

**Files:**
- Create: `frontend/src/utils/colormap.js`

This module exports two functions:
- `prepareWaferArrays(data)` — computes positions + arrow geometry once when data loads
- `buildColorArray(data, colorMin, colorMax)` — recomputes RGBA colors whenever color range changes

- [ ] **Step 1: Create colormap.js**

`frontend/src/utils/colormap.js`:
```js
import { interpolateViridis } from 'd3-scale-chromatic'

const ARROW_LENGTH_MM = 0.5  // fixed world-space arrow length

function parseViridisColor(rgbStr) {
  const [r, g, b] = rgbStr.match(/\d+/g).map(Number)
  return [r, g, b, 220]
}

/**
 * Pre-compute geometry arrays from raw Float32Array (one-time, on data load).
 * Returns { n, positions, arrowSources, arrowTargets }
 *   positions: Float32Array [x, y, x, y, ...] — absolute point positions
 *   arrowSources: Float32Array [x, y, ...] — arrow start positions (same as positions)
 *   arrowTargets: Float32Array [x, y, ...] — arrow end positions (normalized direction * ARROW_LENGTH_MM)
 */
export function prepareWaferArrays(data) {
  const n = data.length / 6
  const positions    = new Float32Array(n * 2)
  const arrowSources = new Float32Array(n * 2)
  const arrowTargets = new Float32Array(n * 2)

  for (let i = 0; i < n; i++) {
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    const intraX = data[i * 6 + 2]
    const intraY = data[i * 6 + 3]
    const ovlX   = data[i * 6 + 4]
    const ovlY   = data[i * 6 + 5]

    const x = interX + intraX
    const y = interY + intraY

    positions[i * 2]     = x
    positions[i * 2 + 1] = y

    arrowSources[i * 2]     = x
    arrowSources[i * 2 + 1] = y

    const mag = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
    const scale = mag > 0 ? ARROW_LENGTH_MM / mag : 0
    arrowTargets[i * 2]     = x + ovlX * scale
    arrowTargets[i * 2 + 1] = y + ovlY * scale
  }

  return { n, positions, arrowSources, arrowTargets }
}

/**
 * Build RGBA Uint8Array from overlay magnitudes.
 * Recomputed whenever colorMin or colorMax changes.
 */
export function buildColorArray(data, colorMin, colorMax) {
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
```

- [ ] **Step 2: Verify no import errors**

In `frontend/src/App.jsx` temporarily add:
```jsx
import { prepareWaferArrays, buildColorArray } from './utils/colormap.js'
console.log('colormap loaded', prepareWaferArrays, buildColorArray)
```

Run `npm run dev`, open browser console — should see "colormap loaded [Function] [Function]". Remove the import after verifying.

- [ ] **Step 3: Commit**

```bash
cd ..
git add frontend/src/utils/
git commit -m "feat: add colormap utility (prepareWaferArrays + buildColorArray)"
```

---

## Task 6: useWaferData Hook

**Files:**
- Create: `frontend/src/hooks/useWaferData.js`

- [ ] **Step 1: Create useWaferData.js**

`frontend/src/hooks/useWaferData.js`:
```js
import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = 'http://localhost:8080/api/wafer-data'

export function useWaferData(points = 500000) {
  const [data, setData]       = useState(null)   // Float32Array
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    axios.get(`${API_URL}?points=${points}`, { responseType: 'arraybuffer' })
      .then(res => {
        if (!cancelled) {
          setData(new Float32Array(res.data))
          setLoading(false)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [points])

  return { data, loading, error }
}
```

- [ ] **Step 2: Wire into App.jsx to verify fetch works**

Replace `frontend/src/App.jsx` with:
```jsx
import './App.css'
import { useWaferData } from './hooks/useWaferData.js'

export default function App() {
  const { data, loading, error } = useWaferData(10000)

  if (loading) return <div style={{ padding: 20 }}>Loading...</div>
  if (error)   return <div style={{ padding: 20, color: 'red' }}>Error: {error}</div>

  return <div style={{ padding: 20 }}>
    Loaded {data.length / 6} points
  </div>
}
```

Make sure the backend is running (`cd backend && ./mvnw spring-boot:run`), then open `http://localhost:5173` — should show "Loaded NNNN points".

- [ ] **Step 3: Commit**

```bash
cd ..
git add frontend/src/hooks/
git commit -m "feat: add useWaferData hook"
```

---

## Task 7: ColorBar Component

**Files:**
- Create: `frontend/src/components/ColorBar.jsx`

Shows a Viridis gradient with two sliders to set `colorMin` and `colorMax`.

- [ ] **Step 1: Create ColorBar.jsx**

`frontend/src/components/ColorBar.jsx`:
```jsx
import { interpolateViridis } from 'd3-scale-chromatic'

const GRADIENT = (() => {
  const stops = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9
    return `${interpolateViridis(t)} ${(t * 100).toFixed(0)}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
})()

export default function ColorBar({ colorMin, colorMax, onMinChange, onMaxChange }) {
  return (
    <div style={styles.container}>
      <div style={styles.label}>OVERLAY MAGNITUDE (nm)</div>

      <div style={{ ...styles.gradient, background: GRADIENT }} />

      <div style={styles.rangeRow}>
        <span style={styles.value}>{colorMin.toFixed(0)}</span>
        <span style={styles.value}>{colorMax.toFixed(0)}</span>
      </div>

      <div style={styles.sliderGroup}>
        <label style={styles.sliderLabel}>Min</label>
        <input
          type="range"
          min={0} max={colorMax - 1} step={1}
          value={colorMin}
          onChange={e => onMinChange(Number(e.target.value))}
          style={styles.slider}
        />
      </div>

      <div style={styles.sliderGroup}>
        <label style={styles.sliderLabel}>Max</label>
        <input
          type="range"
          min={colorMin + 1} max={200} step={1}
          value={colorMax}
          onChange={e => onMaxChange(Number(e.target.value))}
          style={styles.slider}
        />
      </div>
    </div>
  )
}

const styles = {
  container: {
    background: '#1e1e36',
    borderRadius: 6,
    padding: '12px 10px',
  },
  label: {
    fontSize: 9,
    color: '#888',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  gradient: {
    height: 12,
    borderRadius: 3,
    marginBottom: 4,
  },
  rangeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  value: {
    fontSize: 10,
    color: '#aaa',
  },
  sliderGroup: {
    marginBottom: 6,
  },
  sliderLabel: {
    fontSize: 10,
    color: '#888',
    display: 'block',
    marginBottom: 2,
  },
  slider: {
    width: '100%',
    accentColor: '#4a9eff',
  },
}
```

- [ ] **Step 2: Smoke-test ColorBar in App.jsx**

Replace `frontend/src/App.jsx` with:
```jsx
import './App.css'
import { useState } from 'react'
import ColorBar from './components/ColorBar.jsx'

export default function App() {
  const [colorMin, setColorMin] = useState(0)
  const [colorMax, setColorMax] = useState(50)

  return (
    <div style={{ padding: 20, maxWidth: 200 }}>
      <ColorBar
        colorMin={colorMin}
        colorMax={colorMax}
        onMinChange={setColorMin}
        onMaxChange={setColorMax}
      />
      <div style={{ marginTop: 10, fontSize: 12, color: '#aaa' }}>
        Range: {colorMin} – {colorMax} nm
      </div>
    </div>
  )
}
```

Open `http://localhost:5173` — gradient and sliders should appear. Sliders should stay min < max.

- [ ] **Step 3: Commit**

```bash
cd ..
git add frontend/src/components/ColorBar.jsx
git commit -m "feat: add ColorBar component"
```

---

## Task 8: DieInfoPanel Component

**Files:**
- Create: `frontend/src/components/DieInfoPanel.jsx`

Receives a `selectedDie` object and `data` (Float32Array), computes per-die stats client-side.

- [ ] **Step 1: Create DieInfoPanel.jsx**

`frontend/src/components/DieInfoPanel.jsx`:
```jsx
import { useMemo } from 'react'

function computeDieStats(data, interX, interY) {
  let count = 0, sumMag = 0, maxMag = 0, sumOvlX = 0, sumOvlY = 0
  const n = data.length / 6
  for (let i = 0; i < n; i++) {
    if (data[i * 6] === interX && data[i * 6 + 1] === interY) {
      const ovlX = data[i * 6 + 4]
      const ovlY = data[i * 6 + 5]
      const mag  = Math.sqrt(ovlX * ovlX + ovlY * ovlY)
      count++
      sumMag  += mag
      maxMag   = Math.max(maxMag, mag)
      sumOvlX += ovlX
      sumOvlY += ovlY
    }
  }
  if (count === 0) return null
  return {
    count,
    avgMag:  sumMag  / count,
    maxMag,
    avgOvlX: sumOvlX / count,
    avgOvlY: sumOvlY / count,
  }
}

export default function DieInfoPanel({ selectedDie, data }) {
  const stats = useMemo(() => {
    if (!selectedDie || !data) return null
    return computeDieStats(data, selectedDie.interX, selectedDie.interY)
  }, [selectedDie, data])

  if (!selectedDie) {
    return (
      <div style={styles.container}>
        <div style={styles.label}>SELECTED DIE</div>
        <div style={styles.empty}>Click a point to select its die</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.label}>SELECTED DIE</div>
      <div style={styles.dieName}>
        Die ({selectedDie.interX.toFixed(1)}, {selectedDie.interY.toFixed(1)}) mm
      </div>
      {stats && (
        <div style={styles.stats}>
          <Row label="Points"   value={stats.count} />
          <Row label="Avg |ovl|" value={`${stats.avgMag.toFixed(1)} nm`} />
          <Row label="Max |ovl|" value={`${stats.maxMag.toFixed(1)} nm`} />
          <Row label="Avg ovlX"  value={`${stats.avgOvlX.toFixed(1)} nm`} />
          <Row label="Avg ovlY"  value={`${stats.avgOvlY.toFixed(1)} nm`} />
        </div>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  )
}

const styles = {
  container: {
    background: '#1e1e36',
    borderRadius: 6,
    padding: '12px 10px',
    flex: 1,
  },
  label: {
    fontSize: 9,
    color: '#888',
    letterSpacing: '0.08em',
    marginBottom: 8,
  },
  empty: {
    fontSize: 10,
    color: '#555',
    fontStyle: 'italic',
  },
  dieName: {
    fontSize: 11,
    color: '#4a9eff',
    marginBottom: 10,
  },
  stats: { marginTop: 4 },
  rowLabel: { fontSize: 10, color: '#888' },
  rowValue: { fontSize: 10, color: '#ccc' },
}
```

- [ ] **Step 2: Commit**

```bash
cd ..
git add frontend/src/components/DieInfoPanel.jsx
git commit -m "feat: add DieInfoPanel component"
```

---

## Task 9: WaferMapView Component

**Files:**
- Create: `frontend/src/components/WaferMapView.jsx`

deck.gl canvas with `OrthographicView`, `ScatterplotLayer` (always), and `LineLayer` (LOD at zoom ≥ 5). Click identifies the die via `info.index`.

- [ ] **Step 1: Create WaferMapView.jsx**

`frontend/src/components/WaferMapView.jsx`:
```jsx
import { useState, useRef } from 'react'
import DeckGL from '@deck.gl/react'
import { OrthographicView } from '@deck.gl/core'
import { ScatterplotLayer, LineLayer, PolygonLayer } from '@deck.gl/layers'

const WAFER_RADIUS = 150  // mm
const LOD_ZOOM_THRESHOLD = 5

// Build a circle polygon for the wafer boundary
const WAFER_BOUNDARY = (() => {
  const steps = 128
  const ring = Array.from({ length: steps }, (_, i) => {
    const angle = (i / steps) * 2 * Math.PI
    return [Math.cos(angle) * WAFER_RADIUS, Math.sin(angle) * WAFER_RADIUS]
  })
  return [{ contour: ring }]
})()

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0],
  zoom: 1.7,
  minZoom: -2,
  maxZoom: 14,
}

export default function WaferMapView({
  n,            // number of points
  positions,    // Float32Array [x,y, x,y, ...]
  colors,       // Uint8Array   [r,g,b,a, ...]
  arrowSources, // Float32Array for LOD arrows
  arrowTargets, // Float32Array for LOD arrows
  data,         // raw Float32Array (for die lookup on click)
  onDieClick,
}) {
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom)
  const viewStateRef = useRef(INITIAL_VIEW_STATE)

  function handleClick(info) {
    if (info.index == null || info.index < 0 || !data) return
    const i = info.index
    const interX = data[i * 6]
    const interY = data[i * 6 + 1]
    onDieClick({ interX, interY })
  }

  const showArrows = zoom >= LOD_ZOOM_THRESHOLD

  const layers = [
    new PolygonLayer({
      id: 'wafer-boundary',
      data: WAFER_BOUNDARY,
      getPolygon: d => d.contour,
      getFillColor: [20, 20, 40, 200],
      getLineColor: [80, 120, 200, 180],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: true,
    }),

    positions && new ScatterplotLayer({
      id: 'points',
      data: {
        length: n,
        attributes: {
          getPosition: { value: positions, size: 2 },
          getFillColor: { value: colors,    size: 4 },
        },
      },
      getRadius: 0.08,
      radiusMinPixels: 1,
      radiusMaxPixels: 6,
      pickable: true,
      onClick: handleClick,
    }),

    showArrows && arrowSources && new LineLayer({
      id: 'arrows',
      data: {
        length: n,
        attributes: {
          getSourcePosition: { value: arrowSources, size: 2 },
          getTargetPosition: { value: arrowTargets, size: 2 },
        },
      },
      getColor: [255, 255, 255, 160],
      getWidth: 1,
      widthUnits: 'pixels',
    }),
  ].filter(Boolean)

  return (
    <DeckGL
      views={new OrthographicView({ id: 'main' })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
      onViewStateChange={({ viewState }) => {
        viewStateRef.current = viewState
        setZoom(viewState.zoom)
      }}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      <div style={zoomBadgeStyle}>
        zoom {zoom.toFixed(1)} {showArrows ? '· arrows on' : ''}
      </div>
    </DeckGL>
  )
}

const zoomBadgeStyle = {
  position: 'absolute',
  bottom: 8,
  left: 8,
  fontSize: 10,
  color: '#555',
  pointerEvents: 'none',
}
```

- [ ] **Step 2: Commit**

```bash
cd ..
git add frontend/src/components/WaferMapView.jsx
git commit -m "feat: add WaferMapView with ScatterplotLayer and LOD LineLayer"
```

---

## Task 10: App.jsx Integration + Layout

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/App.css`

Wire all components together. Right-panel layout: map fills left, sidebar (ColorBar + DieInfoPanel) on right.

- [ ] **Step 1: Replace App.jsx with full integration**

`frontend/src/App.jsx`:
```jsx
import './App.css'
import { useState, useMemo } from 'react'
import { useWaferData }              from './hooks/useWaferData.js'
import { prepareWaferArrays, buildColorArray } from './utils/colormap.js'
import WaferMapView from './components/WaferMapView.jsx'
import ColorBar     from './components/ColorBar.jsx'
import DieInfoPanel from './components/DieInfoPanel.jsx'

export default function App() {
  const [colorMin, setColorMin] = useState(0)
  const [colorMax, setColorMax] = useState(50)
  const [selectedDie, setSelectedDie] = useState(null)

  const { data, loading, error } = useWaferData(500000)

  const waferArrays = useMemo(() => {
    if (!data) return null
    return prepareWaferArrays(data)
  }, [data])

  const colors = useMemo(() => {
    if (!data) return null
    return buildColorArray(data, colorMin, colorMax)
  }, [data, colorMin, colorMax])

  if (loading) return <div className="status">Loading wafer data…</div>
  if (error)   return <div className="status error">Error: {error}</div>

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={waferArrays.n}
          positions={waferArrays.positions}
          colors={colors}
          arrowSources={waferArrays.arrowSources}
          arrowTargets={waferArrays.arrowTargets}
          data={data}
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
        <DieInfoPanel selectedDie={selectedDie} data={data} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update App.css with layout rules**

`frontend/src/App.css`:
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: 'Inter', sans-serif;
  height: 100vh;
  overflow: hidden;
}

#root {
  height: 100vh;
}

.layout {
  display: flex;
  height: 100vh;
}

.map-area {
  flex: 1;
  position: relative;
  background: #0a0a18;
}

.sidebar {
  width: 200px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px;
  background: #13132a;
  overflow-y: auto;
}

.status {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  font-size: 14px;
  color: #888;
}

.status.error {
  color: #ff6b6b;
}
```

- [ ] **Step 3: Start backend + frontend and verify the full flow**

Terminal 1 (backend):
```bash
cd backend && ./mvnw spring-boot:run
```

Terminal 2 (frontend):
```bash
cd frontend && npm run dev
```

Open `http://localhost:5173`. Expected behavior:
- Loading spinner appears for ~1-2 seconds
- Wafer circle renders with colored points (Viridis)
- Zoom/pan works (mouse wheel + drag)
- Color bar sliders re-color points live
- Zoom in past level 5 → white arrows appear on points
- Click a point → DieInfoPanel shows die stats

- [ ] **Step 4: Commit**

```bash
cd ..
git add frontend/src/App.jsx frontend/src/App.css
git commit -m "feat: integrate all components into full wafermap POC"
```

---

## Task 11: Final Smoke Test + .gitignore

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Add .gitignore**

Create `wafermap-demo/.gitignore`:
```
# Backend
backend/target/
backend/.mvn/

# Frontend
frontend/node_modules/
frontend/dist/

# Superpowers brainstorm (visual companion mockups)
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

- [ ] **Step 3: Final manual smoke test checklist**

With both servers running:

| Check | Expected |
|-------|----------|
| Page loads | ≤ 3 seconds to first render |
| 500k points render | No browser crash, ≥ 30 fps |
| Zoom in (scroll wheel) | Points grow, wafer zooms smoothly |
| Pan (drag) | Canvas moves with mouse |
| Zoom level badge | Shows current zoom number |
| Zoom past 5 | "· arrows on" appears in badge; arrow lines visible on points |
| ColorBar min slider | Points re-color live (no reload) |
| ColorBar max slider | Points re-color live (no reload) |
| Click a point | DieInfoPanel shows die coords + stats |
| Click different point in same die | Same stats |
| Click point in different die | Stats update |
