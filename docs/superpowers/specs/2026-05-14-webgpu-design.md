# WebGPU Compute + Rendering Design

**Date:** 2026-05-14  
**Project:** wafermap-demo  
**Goal:** Replace CPU-side colormap and arrow geometry computation with WebGPU compute shaders; switch deck.gl to WebGPU rendering backend.

---

## Problem

Two performance bottlenecks:

1. **Colormap recomputation** (`buildColorArray`): Every `colorMin`/`colorMax` change triggers 500k iterations of d3's `interpolateViridis` on the CPU. This is the primary pain point.
2. **Arrow geometry generation** (`buildArrowPolygons`): Up to 500k arrows built as JS polygon objects on the CPU, then tessellated by `SolidPolygonLayer`.

**Constraint:** Chrome/Edge only — full WebGPU support, no fallback needed.

---

## Architecture

### Before (CPU pipeline)

```
Raw Float32Array
  → buildColorArray()       CPU, 500k × viridis → Uint8Array
  → buildArrowPolygons()    CPU, 500k × polygon  → ArrowPolygon[]
  → ScatterplotLayer (WebGL2)
  → SolidPolygonLayer (WebGL2)
```

### After (WebGPU pipeline)

```
Raw Float32Array
  → upload once → GPUBuffer (raw data)
        ↓
  [ColorComputePipeline]  WGSL compute → GPUBuffer (RGBA colors)   ──→ ScatterplotLayer (WebGPU)
  [ArrowComputePipeline]  WGSL compute → GPUBuffer (triangles)     ──→ ArrowLayer custom (WebGPU)

  deck.gl uses luma.gl WebGPU device → same GPUDevice → zero CPU readback
```

---

## Compute Pipelines

### ColorComputePipeline (`src/gpu/colorCompute.ts`)

| Item | Detail |
|------|--------|
| Input | `GPUBuffer` — raw float32 data (6 floats/point: interX, interY, intraX, intraY, ovlX, ovlY) |
| Uniform | `colorMin: f32`, `colorMax: f32` |
| LUT | `GPUBuffer` — 256 × RGBA (uploaded once at init from pre-computed viridis) |
| Output | `GPUBuffer` — Uint8 RGBA, 4 bytes/point |
| Workgroup | 256 threads/group |

WGSL logic per point:
```
mag   = sqrt(ovlX² + ovlY²)
t     = clamp((mag - colorMin) / (colorMax - colorMin), 0.0, 1.0)
index = u32(t * 255.0)
color = LUT[index]
```

**Trigger:** On `colorMin`/`colorMax` change — only update uniform buffer, re-dispatch. Raw data buffer is untouched.

---

### ArrowComputePipeline (`src/gpu/arrowCompute.ts`)

| Item | Detail |
|------|--------|
| Input | Same raw data `GPUBuffer` |
| Uniform | `colorMin`, `colorMax`, shaft/head dimension constants |
| Output A | `arrowVertices: GPUBuffer` — Float32, 15 vertices × 2 floats per arrow (5 triangles, pre-tessellated) |
| Output B | `arrowColors: GPUBuffer` — Uint8 RGBA, 15 vertices × 4 bytes per arrow (flat shading) |
| Indirect | `drawIndirectBuffer: GPUBuffer` — atomic counter written by compute shader via `atomicAdd`, used as vertex count by `drawIndirect` to avoid CPU readback |

Output buffers are pre-allocated at max size (`N × 15` vertices). Each compute invocation uses `atomicAdd` on the indirect buffer to claim an output slot. Points with `mag < 1e-9` are skipped and do not increment the counter, so only valid arrows occupy contiguous slots. The final indirect buffer value is the exact vertex count to draw.

**Trigger on data change:** Dispatch both vertex and color compute.  
**Trigger on colorMin/colorMax change:** Only re-dispatch color compute; vertex positions are unchanged.

---

### Support Files (`src/gpu/`)

| File | Responsibility |
|------|----------------|
| `webgpuDevice.ts` | Initialize luma.gl `WebGPUDevice`, export singleton |
| `viridisLUT.ts` | Pre-compute 256 × RGBA viridis LUT on CPU at startup, upload as `GPUBuffer` |
| `positionCompute.ts` | `PositionComputePipeline` — one-time pass computing interX+intraX, interY+intraY |
| `colorCompute.ts` | `ColorComputePipeline` — create, dispatch, manage buffers |
| `arrowCompute.ts` | `ArrowComputePipeline` — create, dispatch, manage buffers |

---

## Rendering Layers

### ScatterplotLayer

Switch `getFillColor` and `getPosition` from CPU `TypedArray` to luma.gl `Buffer` wrapping the compute output `GPUBuffer`:

```ts
// Before
getFillColor: { value: colors, size: 4 }  // Uint8Array from CPU

// After
getFillColor: { buffer: lumaColorBuffer, size: 4 }  // luma.gl Buffer → GPUBuffer
getPosition:  { buffer: lumaPositionBuffer, size: 2 }
```

Position computation (`interX + intraX`, `interY + intraY`) runs as a one-time compute pass when data first loads (`PositionComputePipeline`), separate from ColorComputePipeline. Positions do not change with `colorMin`/`colorMax`, so this pass only reruns when `data` changes.

### ArrowLayer (new custom layer)

`src/layers/ArrowLayer.ts` extends deck.gl `Layer`:
- Accepts `arrowVertexBuffer` and `arrowColorBuffer` (luma.gl Buffers)
- Calls `device.createRenderPipeline` with a simple passthrough vertex shader
- Uses `drawIndirect` with the indirect buffer from ArrowComputePipeline
- No picking needed (`pickable: false`)
- Replaces `SolidPolygonLayer` for arrows

### Boundary Layers (replacing PolygonLayer)

`PolygonLayer` with `stroked: true` is not supported in deck.gl's WebGPU backend.

| Old | New | Reason |
|-----|-----|--------|
| `PolygonLayer` wafer boundary | `SolidPolygonLayer` (fill) + `PathLayer` (outline) | WebGPU stroked polygon unsupported |
| `PolygonLayer` die boundaries | `LineLayer` (4 line segments per die) | Same; LineLayer has full WebGPU support |

Die boundary data stays CPU-generated (small count, not a bottleneck). Each die emits 4 `{ sourcePosition, targetPosition }` entries.

### Final Layer Stack

```
SolidPolygonLayer   ← wafer filled background
PathLayer           ← wafer outline
LineLayer           ← die grid boundaries (CPU-generated, small)
ScatterplotLayer    ← 500k points (GPU color + position buffer)
ArrowLayer          ← pre-tessellated arrows (GPU vertex/color buffer, zoom ≥ 5)
```

---

## Data Flow & State Management

### Lifecycle

```
App mount
  └─ initWebGPU()           → luma.gl GPUDevice singleton
  └─ uploadViridisLUT()     → 256×RGBA GPUBuffer (once)

data loaded
  └─ uploadRawData()        → raw Float32Array → GPUBuffer (once)
  └─ dispatchPositionCompute()  ← one-time: interX+intraX, interY+intraY
  └─ dispatchColorCompute()
  └─ dispatchArrowCompute() (vertices + colors)

colorMin / colorMax changed
  └─ updateColorUniform()   → update uniform buffer only
  └─ dispatchColorCompute()
  └─ dispatchArrowColorCompute()  ← color only, vertices unchanged

zoom changed (LOD)
  └─ showArrows flag toggle → ArrowLayer visibility (no GPU work)
```

### New Hook: `useGpuCompute` (`src/hooks/useGpuCompute.ts`)

Encapsulates all GPU pipeline management. Returns:
```ts
{
  colorBuffer:       LumaBuffer  // for ScatterplotLayer getFillColor
  positionBuffer:    LumaBuffer  // for ScatterplotLayer getPosition
  arrowVertexBuffer: LumaBuffer  // for ArrowLayer
  arrowColorBuffer:  LumaBuffer  // for ArrowLayer
  arrowIndirectBuffer: GPUBuffer // for ArrowLayer drawIndirect
}
```

`App.tsx` has no direct WebGPU API calls. It calls `useGpuCompute(data, colorMin, colorMax)` and passes the returned buffers to `WaferMapView`.

### Changes to Existing Files

| File | Change |
|------|--------|
| `App.tsx` | Remove `buildColorArray`, `buildArrowPolygons`, `prepareWaferArrays` calls; add `useGpuCompute` |
| `WaferMapView.tsx` | Replace `PolygonLayer` with `SolidPolygonLayer + PathLayer + LineLayer`; replace `SolidPolygonLayer` arrows with `ArrowLayer`; accept buffer props instead of typed arrays |
| `colormap.ts` | Keep functions (reference/fallback) but no longer called at runtime |
| `main.tsx` | Initialize WebGPU device before React render |

---

## New Files Summary

```
src/
  gpu/
    webgpuDevice.ts      ← GPUDevice singleton (luma.gl WebGPUDevice)
    viridisLUT.ts        ← 256×RGBA LUT, uploaded once
    positionCompute.ts   ← PositionComputePipeline (one-time on data load)
    colorCompute.ts      ← ColorComputePipeline
    arrowCompute.ts      ← ArrowComputePipeline
  layers/
    ArrowLayer.ts        ← custom deck.gl layer for pre-tessellated arrows
  hooks/
    useGpuCompute.ts     ← React hook managing all GPU pipeline state
docs/
  superpowers/
    specs/
      2026-05-14-webgpu-design.md   ← this file
```

---

## Dependencies to Add

```json
"@luma.gl/webgpu": "^9.x"
```

`@luma.gl/core` is already a transitive dependency of `@deck.gl/core`. Only the webgpu adapter package needs to be added explicitly.
