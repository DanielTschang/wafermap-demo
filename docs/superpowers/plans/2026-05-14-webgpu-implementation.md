# WebGPU Compute + Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CPU-side colormap and arrow geometry computation with WebGPU compute shaders, and switch deck.gl to WebGPU rendering backend. colorMin/colorMax changes trigger only a 256-workgroup GPU dispatch instead of 500k JS iterations.

**Architecture:** A luma.gl WebGPU device is created in `main.tsx` before React renders and stored as a module singleton. Three compute pipelines (position, color, arrow) write into `GPUBuffer`s that deck.gl consumes as vertex attributes with zero CPU readback. A custom `ArrowLayer` renders pre-tessellated arrow triangles from GPU buffers. Arrow colors and positions are in separate compute passes so only color re-runs when `colorMin`/`colorMax` changes.

**Tech Stack:** deck.gl 9.3, @luma.gl/webgpu 9.3, @luma.gl/engine 9.3, raw WebGPU API (WGSL compute shaders), React 19, TypeScript

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/gpu/webgpuDevice.ts` | Device singleton + raw GPUDevice accessor |
| Create | `src/gpu/viridisLUT.ts` | Pre-computed 256-entry viridis LUT → GPUBuffer |
| Create | `src/gpu/positionCompute.ts` | WGSL compute: interX+intraX, interY+intraY → position GPUBuffer |
| Create | `src/gpu/colorCompute.ts` | WGSL compute: mag → LUT lookup → RGBA GPUBuffer |
| Create | `src/gpu/arrowCompute.ts` | Two WGSL passes: arrow vertices (on data change) + colors (on color change) |
| Create | `src/layers/ArrowLayer.ts` | Custom deck.gl Layer consuming pre-tessellated GPU triangle buffers |
| Create | `src/hooks/useGpuCompute.ts` | React hook coordinating all GPU pipelines and buffer lifecycle |
| Modify | `src/main.tsx` | Async bootstrap: init WebGPU device before React render |
| Modify | `src/App.tsx` | Replace CPU compute calls with `useGpuCompute`; pass buffer props |
| Modify | `src/components/WaferMapView.tsx` | Replace PolygonLayer → SolidPolygonLayer+PathLayer+LineLayer; add ArrowLayer; accept buffer props |

---

### Task 1: Install dependencies and verify WebGPU availability

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install @luma.gl/webgpu and WebGPU types**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend
npm install @luma.gl/webgpu@^9.3.0
npm install --save-dev @webgpu/types
```

- [ ] **Step 2: Add WebGPU types to tsconfig**

Read `frontend/tsconfig.app.json`. Add `"@webgpu/types"` to `compilerOptions.types` array (create the array if it doesn't exist):

```json
{
  "compilerOptions": {
    "types": ["@webgpu/types"]
  }
}
```

- [ ] **Step 3: Verify package installed**

```bash
ls frontend/node_modules/@luma.gl/webgpu/package.json
```

Expected output: the path prints without error.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.app.json
git commit -m "chore: install @luma.gl/webgpu and @webgpu/types"
```

---

### Task 2: `src/gpu/webgpuDevice.ts` — Device singleton

**Files:**
- Create: `src/gpu/webgpuDevice.ts`

- [ ] **Step 1: Create the file**

```ts
import type {Device} from '@luma.gl/core';

let _device: Device | null = null;

export function setDevice(device: Device): void {
  _device = device;
}

export function getDevice(): Device {
  if (!_device) throw new Error('WebGPU device not initialized — call setDevice first');
  return _device;
}

/** Returns the raw GPUDevice underlying the luma.gl device wrapper. */
export function getRawGpu(): GPUDevice {
  const d = getDevice() as unknown as Record<string, unknown>;
  // luma.gl WebGPUDevice exposes the raw device as .device or .handle
  const raw = (d['device'] ?? d['handle']) as GPUDevice | undefined;
  if (!raw) throw new Error('Could not access raw GPUDevice from luma.gl device');
  return raw;
}
```

Save to `frontend/src/gpu/webgpuDevice.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/gpu/webgpuDevice.ts
git commit -m "feat: add WebGPU device singleton"
```

---

### Task 3: `src/gpu/viridisLUT.ts` — Viridis LUT upload

**Files:**
- Create: `src/gpu/viridisLUT.ts`

- [ ] **Step 1: Create the file**

```ts
import {interpolateViridis} from 'd3-scale-chromatic';
import {getRawGpu} from './webgpuDevice';

/** Builds a 256-entry Uint32Array LUT where each u32 is packed RGBA (little-endian bytes: R,G,B,A). */
function buildLutData(): Uint32Array {
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const str = interpolateViridis(t);                  // "rgb(r, g, b)"
    const [r, g, b] = str.match(/\d+/g)!.map(Number);
    lut[i] = ((r | (g << 8) | (b << 16) | (220 << 24)) >>> 0);
  }
  return lut;
}

let _lutBuffer: GPUBuffer | null = null;

/** Returns (or creates) the viridis LUT as a GPU storage buffer. Created once, never destroyed. */
export function getViridisLutBuffer(): GPUBuffer {
  if (_lutBuffer) return _lutBuffer;
  const data = buildLutData();
  const gpu = getRawGpu();
  _lutBuffer = gpu.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(_lutBuffer.getMappedRange()).set(data);
  _lutBuffer.unmap();
  return _lutBuffer;
}
```

Save to `frontend/src/gpu/viridisLUT.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/gpu/viridisLUT.ts
git commit -m "feat: add viridis LUT GPU buffer"
```

---

### Task 4: `src/gpu/positionCompute.ts` — Position compute pipeline

**Files:**
- Create: `src/gpu/positionCompute.ts`

Each thread reads 6 floats for point `i` and writes `interX+intraX`, `interY+intraY` to a position buffer used by ScatterplotLayer.

- [ ] **Step 1: Create the file**

```ts
import type {Device} from '@luma.gl/core';
import {getRawGpu} from './webgpuDevice';

const WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read>       rawData:   array<f32>;
@group(0) @binding(1) var<storage, read_write> positions: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&rawData) / 6u) { return; }
  positions[i * 2u]      = rawData[i * 6u]      + rawData[i * 6u + 2u];
  positions[i * 2u + 1u] = rawData[i * 6u + 1u] + rawData[i * 6u + 3u];
}
`;

export interface PositionCompute {
  /** luma.gl Buffer — use as ScatterplotLayer getPosition attribute. */
  positionBuffer: import('@luma.gl/core').Buffer;
  dispatch(rawDataGpuBuffer: GPUBuffer, n: number): void;
  destroy(): void;
}

export function createPositionCompute(device: Device, n: number): PositionCompute {
  const gpu = getRawGpu();

  // Create output buffer via luma.gl so deck.gl can bind it as a vertex attribute.
  // GPUBufferUsage.VERTEX makes it usable as vertex buffer; STORAGE for compute write.
  const positionBuffer = device.createBuffer({
    byteLength: n * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  const posGpuBuf = (positionBuffer as unknown as {handle: GPUBuffer}).handle;

  const module = gpu.createShaderModule({code: WGSL});
  const pipeline = gpu.createComputePipeline({
    layout: 'auto',
    compute: {module, entryPoint: 'main'},
  });

  function dispatch(rawDataGpuBuffer: GPUBuffer, n: number): void {
    const bindGroup = gpu.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: rawDataGpuBuffer}},
        {binding: 1, resource: {buffer: posGpuBuf}},
      ],
    });
    const enc = gpu.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    gpu.queue.submit([enc.finish()]);
  }

  function destroy(): void {
    positionBuffer.destroy();
  }

  return {positionBuffer, dispatch, destroy};
}
```

Save to `frontend/src/gpu/positionCompute.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/gpu/positionCompute.ts
git commit -m "feat: add position compute pipeline"
```

---

### Task 5: `src/gpu/colorCompute.ts` — Color compute pipeline

**Files:**
- Create: `src/gpu/colorCompute.ts`

Each thread computes `mag(ovlX, ovlY)`, normalizes against `colorMin`/`colorMax`, looks up viridis LUT, and writes a packed RGBA u32 to the color buffer.

- [ ] **Step 1: Create the file**

```ts
import type {Device} from '@luma.gl/core';
import {getRawGpu} from './webgpuDevice';
import {getViridisLutBuffer} from './viridisLUT';

const WGSL = /* wgsl */`
struct Uni { colorMin: f32, colorMax: f32 }

@group(0) @binding(0) var<storage, read>       rawData: array<f32>;
@group(0) @binding(1) var<storage, read_write> colors:  array<u32>;  // packed RGBA u8
@group(0) @binding(2) var<storage, read>       lut:     array<u32>;  // 256 entries
@group(0) @binding(3) var<uniform>             uni:     Uni;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&rawData) / 6u) { return; }
  let ovlX = rawData[i * 6u + 4u];
  let ovlY = rawData[i * 6u + 5u];
  let mag  = sqrt(ovlX * ovlX + ovlY * ovlY);
  let rng  = uni.colorMax - uni.colorMin;
  let t    = clamp((mag - uni.colorMin) / select(rng, 1.0, rng == 0.0), 0.0, 1.0);
  colors[i] = lut[u32(t * 255.0)];
}
`;

export interface ColorCompute {
  /** luma.gl Buffer — use as ScatterplotLayer getFillColor attribute. */
  colorBuffer: import('@luma.gl/core').Buffer;
  dispatch(rawDataGpuBuffer: GPUBuffer, n: number, colorMin: number, colorMax: number): void;
  destroy(): void;
}

export function createColorCompute(device: Device, n: number): ColorCompute {
  const gpu = getRawGpu();

  const colorBuffer = device.createBuffer({
    byteLength: n * 4,  // 4 bytes RGBA per point
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  const colGpuBuf = (colorBuffer as unknown as {handle: GPUBuffer}).handle;

  const uniformBuffer = gpu.createBuffer({
    size: 8,  // 2 × f32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const module = gpu.createShaderModule({code: WGSL});
  const pipeline = gpu.createComputePipeline({
    layout: 'auto',
    compute: {module, entryPoint: 'main'},
  });

  function dispatch(rawDataGpuBuffer: GPUBuffer, n: number, colorMin: number, colorMax: number): void {
    gpu.queue.writeBuffer(uniformBuffer, 0, new Float32Array([colorMin, colorMax]));
    const bindGroup = gpu.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: rawDataGpuBuffer}},
        {binding: 1, resource: {buffer: colGpuBuf}},
        {binding: 2, resource: {buffer: getViridisLutBuffer()}},
        {binding: 3, resource: {buffer: uniformBuffer}},
      ],
    });
    const enc = gpu.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    gpu.queue.submit([enc.finish()]);
  }

  function destroy(): void {
    colorBuffer.destroy();
    uniformBuffer.destroy();
  }

  return {colorBuffer, dispatch, destroy};
}
```

Save to `frontend/src/gpu/colorCompute.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/gpu/colorCompute.ts
git commit -m "feat: add color compute pipeline"
```

---

### Task 6: `src/gpu/arrowCompute.ts` — Arrow vertex + color compute pipelines

**Files:**
- Create: `src/gpu/arrowCompute.ts`

Two separate WGSL passes:
- **Vertex pass**: runs on data change. Outputs 15 vertices (5 triangles) per point into a flat position buffer. Invalid points (mag < 1e-9) write degenerate triangles (all zeros).
- **Color pass**: runs on data OR color change. Outputs 15 identical packed RGBA u32 values per point.

Total vertex count is always `n * 15` (no draw count readback needed).

- [ ] **Step 1: Create the file**

```ts
import type {Device} from '@luma.gl/core';
import {getRawGpu} from './webgpuDevice';
import {getViridisLutBuffer} from './viridisLUT';

// Constants matching colormap.ts
const VECTOR_SCALE_MM_PER_NM = 0.01;
const SHAFT_HALF_WIDTH        = 0.015; // SHAFT_WIDTH_MM / 2
const HEAD_HALF_WIDTH         = 0.045; // HEAD_WIDTH_MM / 2
const HEAD_LENGTH_RATIO       = 0.25;

const VERTEX_WGSL = /* wgsl */`
struct Uni {
  vectorScale:     f32,
  shaftHalfWidth:  f32,
  headHalfWidth:   f32,
  headLengthRatio: f32,
}

@group(0) @binding(0) var<storage, read>       rawData:  array<f32>;
@group(0) @binding(1) var<storage, read_write> vertXY:   array<f32>;  // 15 × 2 floats per point
@group(0) @binding(2) var<uniform>             uni:      Uni;

fn rot(px: f32, py: f32, cx: f32, cy: f32, dx: f32, dy: f32) -> vec2<f32> {
  return vec2<f32>(cx + px * dy + py * dx, cy - px * dx + py * dy);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i    = gid.x;
  let n    = arrayLength(&rawData) / 6u;
  if (i >= n) { return; }

  let base = i * 30u;  // 15 verts × 2 floats
  let ovlX = rawData[i * 6u + 4u];
  let ovlY = rawData[i * 6u + 5u];
  let mag  = sqrt(ovlX * ovlX + ovlY * ovlY);

  if (mag < 1e-9) {
    for (var j = 0u; j < 30u; j++) { vertXY[base + j] = 0.0; }
    return;
  }

  let cx = rawData[i * 6u]      + rawData[i * 6u + 2u];
  let cy = rawData[i * 6u + 1u] + rawData[i * 6u + 3u];
  let dx = ovlX / mag;
  let dy = ovlY / mag;

  let dLen = mag * uni.vectorScale;
  let sLen = dLen * (1.0 - uni.headLengthRatio);
  let hLen = dLen * uni.headLengthRatio;
  let sw   = uni.shaftHalfWidth;
  let hw   = uni.headHalfWidth;

  let v0 = rot(-sw, 0.0,       cx, cy, dx, dy);
  let v1 = rot(-sw, sLen,      cx, cy, dx, dy);
  let v2 = rot(-hw, sLen,      cx, cy, dx, dy);
  let v3 = rot(0.0, sLen+hLen, cx, cy, dx, dy);
  let v4 = rot( hw, sLen,      cx, cy, dx, dy);
  let v5 = rot( sw, sLen,      cx, cy, dx, dy);
  let v6 = rot( sw, 0.0,       cx, cy, dx, dy);

  // 5 triangles (fan from v0): v0v1v2, v0v2v3, v0v3v4, v0v4v5, v0v5v6
  var verts: array<vec2<f32>, 15>;
  verts[0]  = v0; verts[1]  = v1; verts[2]  = v2;
  verts[3]  = v0; verts[4]  = v2; verts[5]  = v3;
  verts[6]  = v0; verts[7]  = v3; verts[8]  = v4;
  verts[9]  = v0; verts[10] = v4; verts[11] = v5;
  verts[12] = v0; verts[13] = v5; verts[14] = v6;

  for (var j = 0u; j < 15u; j++) {
    vertXY[base + j * 2u]      = verts[j].x;
    vertXY[base + j * 2u + 1u] = verts[j].y;
  }
}
`;

const COLOR_WGSL = /* wgsl */`
struct Uni { colorMin: f32, colorMax: f32 }

@group(0) @binding(0) var<storage, read>       rawData: array<f32>;
@group(0) @binding(1) var<storage, read_write> colors:  array<u32>;  // 15 packed RGBA per point
@group(0) @binding(2) var<storage, read>       lut:     array<u32>;
@group(0) @binding(3) var<uniform>             uni:     Uni;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i    = gid.x;
  if (i >= arrayLength(&rawData) / 6u) { return; }
  let base = i * 15u;
  let ovlX = rawData[i * 6u + 4u];
  let ovlY = rawData[i * 6u + 5u];
  let mag  = sqrt(ovlX * ovlX + ovlY * ovlY);
  if (mag < 1e-9) {
    for (var j = 0u; j < 15u; j++) { colors[base + j] = 0u; }
    return;
  }
  let rng   = uni.colorMax - uni.colorMin;
  let t     = clamp((mag - uni.colorMin) / select(rng, 1.0, rng == 0.0), 0.0, 1.0);
  let color = lut[u32(t * 255.0)];
  for (var j = 0u; j < 15u; j++) { colors[base + j] = color; }
}
`;

export interface ArrowCompute {
  /** luma.gl Buffer — xy positions for all n×15 vertices. */
  vertexBuffer: import('@luma.gl/core').Buffer;
  /** luma.gl Buffer — packed RGBA u32 for all n×15 vertices. */
  colorBuffer: import('@luma.gl/core').Buffer;
  /** Always n * 15 — no readback needed. */
  vertexCount: number;
  dispatchVertices(rawDataGpuBuffer: GPUBuffer, n: number): void;
  dispatchColors(rawDataGpuBuffer: GPUBuffer, n: number, colorMin: number, colorMax: number): void;
  destroy(): void;
}

export function createArrowCompute(device: Device, n: number): ArrowCompute {
  const gpu = getRawGpu();
  const vertexCount = n * 15;

  const vertexBuffer = device.createBuffer({
    byteLength: vertexCount * 2 * 4,  // xy float32 per vertex
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });
  const colorBuffer = device.createBuffer({
    byteLength: vertexCount * 4,  // RGBA u8 per vertex
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
  });

  const vertGpuBuf  = (vertexBuffer as unknown as {handle: GPUBuffer}).handle;
  const colorGpuBuf = (colorBuffer  as unknown as {handle: GPUBuffer}).handle;

  const vertUniBuffer = gpu.createBuffer({
    size: 16,  // 4 × f32, aligned to 16 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  gpu.queue.writeBuffer(vertUniBuffer, 0, new Float32Array([
    VECTOR_SCALE_MM_PER_NM,
    SHAFT_HALF_WIDTH,
    HEAD_HALF_WIDTH,
    HEAD_LENGTH_RATIO,
  ]));

  const colorUniBuffer = gpu.createBuffer({
    size: 8,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const vertModule  = gpu.createShaderModule({code: VERTEX_WGSL});
  const colorModule = gpu.createShaderModule({code: COLOR_WGSL});
  const vertPipeline  = gpu.createComputePipeline({layout: 'auto', compute: {module: vertModule,  entryPoint: 'main'}});
  const colorPipeline = gpu.createComputePipeline({layout: 'auto', compute: {module: colorModule, entryPoint: 'main'}});

  function dispatchVertices(rawDataGpuBuffer: GPUBuffer, n: number): void {
    const bg = gpu.createBindGroup({
      layout: vertPipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: rawDataGpuBuffer}},
        {binding: 1, resource: {buffer: vertGpuBuf}},
        {binding: 2, resource: {buffer: vertUniBuffer}},
      ],
    });
    const enc = gpu.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(vertPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    gpu.queue.submit([enc.finish()]);
  }

  function dispatchColors(rawDataGpuBuffer: GPUBuffer, n: number, colorMin: number, colorMax: number): void {
    gpu.queue.writeBuffer(colorUniBuffer, 0, new Float32Array([colorMin, colorMax]));
    const bg = gpu.createBindGroup({
      layout: colorPipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: rawDataGpuBuffer}},
        {binding: 1, resource: {buffer: colorGpuBuf}},
        {binding: 2, resource: {buffer: getViridisLutBuffer()}},
        {binding: 3, resource: {buffer: colorUniBuffer}},
      ],
    });
    const enc = gpu.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(colorPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    gpu.queue.submit([enc.finish()]);
  }

  function destroy(): void {
    vertexBuffer.destroy();
    colorBuffer.destroy();
    vertUniBuffer.destroy();
    colorUniBuffer.destroy();
  }

  return {vertexBuffer, colorBuffer, vertexCount, dispatchVertices, dispatchColors, destroy};
}
```

Save to `frontend/src/gpu/arrowCompute.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/gpu/arrowCompute.ts
git commit -m "feat: add arrow vertex and color compute pipelines"
```

---

### Task 7: `src/layers/ArrowLayer.ts` — Custom deck.gl layer

**Files:**
- Create: `src/layers/ArrowLayer.ts`

Consumes pre-tessellated GPU vertex and color buffers. Uses the viewport's `viewProjectionMatrix` to project arrow coordinates (mm) to clip space. No picking (arrows are display-only).

- [ ] **Step 1: Create the file**

```ts
import {Layer} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {LayerProps, UpdateParameters} from '@deck.gl/core';
import type {RenderPass} from '@luma.gl/core';
import type {Buffer} from '@luma.gl/core';

// GLSL 300 ES — luma.gl auto-transpiles to WGSL for WebGPU backend.
const VS = /* glsl */`\
#version 300 es
uniform mat4 u_viewProjectionMatrix;
in vec2 arrowPositions;
in vec4 arrowColors;
out vec4 vColor;
void main() {
  vColor = arrowColors;
  gl_Position = u_viewProjectionMatrix * vec4(arrowPositions, 0.0, 1.0);
}
`;

const FS = /* glsl */`\
#version 300 es
precision highp float;
in vec4 vColor;
out vec4 fragColor;
void main() {
  fragColor = vColor;
}
`;

export interface ArrowLayerProps extends LayerProps {
  vertexBuffer: Buffer | null;
  colorBuffer: Buffer | null;
  vertexCount: number;
}

export class ArrowLayer extends Layer<ArrowLayerProps> {
  static layerName = 'ArrowLayer';
  static defaultProps = {
    vertexBuffer: {type: 'object', value: null},
    colorBuffer:  {type: 'object', value: null},
    vertexCount:  {type: 'number', value: 0},
  };

  initializeState(): void {
    const {device} = this.context;
    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: 'triangle-list',
      bufferLayout: [
        {name: 'arrowPositions', format: 'float32x2'},
        {name: 'arrowColors',    format: 'unorm8x4'},
      ],
    });
    this.setState({model});
  }

  updateState({props, oldProps}: UpdateParameters<this>): void {
    const {model} = this.state as {model: Model};
    const buffersChanged =
      props.vertexBuffer !== oldProps.vertexBuffer ||
      props.colorBuffer  !== oldProps.colorBuffer;
    if (buffersChanged && props.vertexBuffer && props.colorBuffer) {
      model.setAttributes({
        arrowPositions: props.vertexBuffer,
        arrowColors:    props.colorBuffer,
      });
    }
  }

  draw({renderPass}: {renderPass: RenderPass}): void {
    const {model} = this.state as {model: Model};
    const {vertexBuffer, colorBuffer, vertexCount} = this.props;
    if (!vertexBuffer || !colorBuffer || vertexCount <= 0) return;
    model.draw(renderPass, {
      vertexCount,
      uniforms: {
        u_viewProjectionMatrix: this.context.viewport.viewProjectionMatrix,
      },
    });
  }

  finalizeState(): void {
    (this.state as {model: Model}).model?.destroy();
  }
}
```

Save to `frontend/src/layers/ArrowLayer.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/layers/ArrowLayer.ts
git commit -m "feat: add custom ArrowLayer consuming GPU triangle buffers"
```

---

### Task 8: `src/hooks/useGpuCompute.ts` — GPU compute hook

**Files:**
- Create: `src/hooks/useGpuCompute.ts`

Manages lifecycle of all three compute pipelines. Uploads raw data once per `data` change. Re-runs only color passes when `colorMin`/`colorMax` changes.

- [ ] **Step 1: Create the file**

```ts
import {useEffect, useRef, useState} from 'react';
import {getDevice, getRawGpu} from '../gpu/webgpuDevice';
import {getViridisLutBuffer} from '../gpu/viridisLUT';
import {createPositionCompute} from '../gpu/positionCompute';
import {createColorCompute} from '../gpu/colorCompute';
import {createArrowCompute} from '../gpu/arrowCompute';
import type {Buffer} from '@luma.gl/core';
import type {PositionCompute} from '../gpu/positionCompute';
import type {ColorCompute} from '../gpu/colorCompute';
import type {ArrowCompute} from '../gpu/arrowCompute';

export interface GpuBuffers {
  positionBuffer:     Buffer;
  colorBuffer:        Buffer;
  arrowVertexBuffer:  Buffer;
  arrowColorBuffer:   Buffer;
  arrowVertexCount:   number;
}

export function useGpuCompute(
  data: Float32Array | null,
  colorMin: number,
  colorMax: number,
): GpuBuffers | null {
  const posRef   = useRef<PositionCompute | null>(null);
  const colRef   = useRef<ColorCompute | null>(null);
  const arrowRef = useRef<ArrowCompute | null>(null);
  const rawGpuBufRef = useRef<GPUBuffer | null>(null);
  const nRef     = useRef<number>(0);

  const [buffers, setBuffers] = useState<GpuBuffers | null>(null);

  // Re-run all compute when data changes
  useEffect(() => {
    if (!data) return;
    const device = getDevice();
    const gpu    = getRawGpu();
    const n      = data.length / 6;
    nRef.current = n;

    // Ensure LUT is ready
    getViridisLutBuffer();

    // Destroy old pipelines and buffers
    posRef.current?.destroy();
    colRef.current?.destroy();
    arrowRef.current?.destroy();
    rawGpuBufRef.current?.destroy();

    // Upload raw data once
    const rawGpuBuf = gpu.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpu.queue.writeBuffer(rawGpuBuf, 0, data);
    rawGpuBufRef.current = rawGpuBuf;

    // Create pipelines
    const pos   = createPositionCompute(device, n);
    const col   = createColorCompute(device, n);
    const arrow = createArrowCompute(device, n);
    posRef.current   = pos;
    colRef.current   = col;
    arrowRef.current = arrow;

    // Dispatch all passes
    pos.dispatch(rawGpuBuf, n);
    col.dispatch(rawGpuBuf, n, colorMin, colorMax);
    arrow.dispatchVertices(rawGpuBuf, n);
    arrow.dispatchColors(rawGpuBuf, n, colorMin, colorMax);

    setBuffers({
      positionBuffer:    pos.positionBuffer,
      colorBuffer:       col.colorBuffer,
      arrowVertexBuffer: arrow.vertexBuffer,
      arrowColorBuffer:  arrow.colorBuffer,
      arrowVertexCount:  arrow.vertexCount,
    });

    return () => {
      pos.destroy();
      col.destroy();
      arrow.destroy();
      rawGpuBuf.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Re-run only color passes when colorMin/colorMax changes
  useEffect(() => {
    const rawGpuBuf = rawGpuBufRef.current;
    const col   = colRef.current;
    const arrow = arrowRef.current;
    const n     = nRef.current;
    if (!rawGpuBuf || !col || !arrow || n === 0) return;

    col.dispatch(rawGpuBuf, n, colorMin, colorMax);
    arrow.dispatchColors(rawGpuBuf, n, colorMin, colorMax);
  }, [colorMin, colorMax]);

  return buffers;
}
```

Save to `frontend/src/hooks/useGpuCompute.ts`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useGpuCompute.ts
git commit -m "feat: add useGpuCompute hook managing GPU pipeline lifecycle"
```

---

### Task 9: Modify `src/main.tsx` — Async WebGPU bootstrap

**Files:**
- Modify: `src/main.tsx`

Initialize the luma.gl WebGPU device before React renders. This ensures `getDevice()` is always valid when any component mounts.

- [ ] **Step 1: Read the current file**

Read `frontend/src/main.tsx` to see the current content.

- [ ] **Step 2: Replace with async bootstrap**

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {luma} from '@luma.gl/core';
import {WebGPUDevice} from '@luma.gl/webgpu';
import {setDevice} from './gpu/webgpuDevice';
import App from './App';
import './index.css';

async function bootstrap(): Promise<void> {
  luma.registerAdapters([WebGPUDevice]);
  const device = await luma.createDevice({type: 'webgpu'});
  setDevice(device);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap().catch(err => {
  document.getElementById('root')!.textContent = `WebGPU init failed: ${err.message}`;
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.tsx
git commit -m "feat: async WebGPU device init before React render"
```

---

### Task 10: Modify `src/App.tsx` — Wire useGpuCompute

**Files:**
- Modify: `src/App.tsx`

Replace `buildColorArray`, `buildArrowPolygons`, `prepareWaferArrays` CPU calls with `useGpuCompute`. Pass `GpuBuffers` to `WaferMapView` instead of typed arrays.

- [ ] **Step 1: Read the current file**

Read `frontend/src/App.tsx`.

- [ ] **Step 2: Replace the file**

```tsx
import './App.css'
import {useState} from 'react'
import {useWaferData}   from './hooks/useWaferData.ts'
import {useGpuCompute}  from './hooks/useGpuCompute.ts'
import type {FieldParams} from './hooks/useWaferData.ts'
import WaferMapView     from './components/WaferMapView.tsx'
import ColorBar         from './components/ColorBar.tsx'
import DieInfoPanel     from './components/DieInfoPanel.tsx'
import type {SelectedDie} from './components/DieInfoPanel.tsx'
import FieldParamsPanel from './components/FieldParamsPanel.tsx'

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

  const {data, loading, error} = useWaferData(500000, fieldParams)
  const gpuBuffers = useGpuCompute(data, colorMin, colorMax)

  if (loading)                    return <div className="status">Loading wafer data…</div>
  if (error)                      return <div className="status error">Error: {error}</div>
  if (!data || !gpuBuffers)       return <div className="status">Initialising GPU…</div>

  return (
    <div className="layout">
      <div className="map-area">
        <WaferMapView
          n={data.length / 6}
          gpuBuffers={gpuBuffers}
          data={data}
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
        <DieInfoPanel selectedDie={selectedDie} data={data} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: replace CPU compute with useGpuCompute in App"
```

---

### Task 11: Modify `src/components/WaferMapView.tsx` — WebGPU layers

**Files:**
- Modify: `src/components/WaferMapView.tsx`

Four changes:
1. Accept `gpuBuffers: GpuBuffers` prop instead of separate typed arrays.
2. Replace `PolygonLayer` (wafer boundary) → `SolidPolygonLayer` + `PathLayer`.
3. Replace `PolygonLayer` (die boundaries) → `LineLayer`.
4. Replace `SolidPolygonLayer` (arrows) → `ArrowLayer`.
5. Pass `device={getDevice()}` to `DeckGL` for WebGPU rendering.

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/WaferMapView.tsx`.

- [ ] **Step 2: Replace the file**

```tsx
import {useState, useRef, useMemo, useCallback} from 'react'
import DeckGL from '@deck.gl/react'
import {OrthographicView} from '@deck.gl/core'
import {ScatterplotLayer, SolidPolygonLayer, PathLayer, LineLayer} from '@deck.gl/layers'
import type {PickingInfo} from '@deck.gl/core'
import type {SelectedDie} from './DieInfoPanel.tsx'
import type {FieldParams} from '../hooks/useWaferData.ts'
import type {GpuBuffers} from '../hooks/useGpuCompute.ts'
import {ArrowLayer} from '../layers/ArrowLayer.ts'
import {getDevice} from '../gpu/webgpuDevice.ts'

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
  gpuBuffers: GpuBuffers
  data: Float32Array
  fieldParams: FieldParams
  onDieClick: (die: SelectedDie) => void
}

export default function WaferMapView({n, gpuBuffers, data, fieldParams, onDieClick}: WaferMapViewProps) {
  const [zoom, setZoom] = useState(INITIAL_VIEW_STATE.zoom)

  const handleClick = useCallback((info: PickingInfo): void => {
    if (info.index == null || info.index < 0) return
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

  const layers = useMemo(() => [
    new SolidPolygonLayer({
      id: 'wafer-fill',
      data: WAFER_FILLED,
      getPolygon: (d: {polygon: number[][]}) => d.polygon,
      getFillColor: [20, 20, 40, 200] as [number, number, number, number],
      filled: true,
    }),

    new PathLayer({
      id: 'wafer-outline',
      data: WAFER_PATH,
      getPath: (d: {path: number[][]}) => d.path,
      getColor: [80, 120, 200, 180] as [number, number, number, number],
      getWidth: 1,
      widthUnits: 'pixels' as const,
    }),

    new LineLayer({
      id: 'die-boundaries',
      data: dieBoundaries,
      getSourcePosition: (d: {sourcePosition: number[]}) => d.sourcePosition,
      getTargetPosition: (d: {targetPosition: number[]}) => d.targetPosition,
      getColor: [100, 100, 160, 160] as [number, number, number, number],
      getWidth: 0.5,
      widthUnits: 'pixels' as const,
    }),

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
  ], [n, gpuBuffers, dieBoundaries, showArrows, handleClick])

  return (
    <DeckGL
      device={getDevice()}
      views={new OrthographicView({id: 'main'})}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      layers={layers}
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
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/WaferMapView.tsx
git commit -m "feat: switch WaferMapView to WebGPU backend with GPU buffer attributes"
```

---

### Task 12: Visual verification in browser

**Files:** (none modified)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/danieltschang/Projects/wafermap-demo/frontend
npm run dev
```

Expected: server starts on `http://localhost:5173` (or similar port), no TypeScript errors in output.

- [ ] **Step 2: Open Chrome and verify baseline rendering**

Open `http://localhost:5173` in Chrome (must be Chrome 113+ for WebGPU).

Expected:
- Wafer circle renders with dark fill and blue outline
- ~500k colored dots render correctly
- Die grid lines visible
- Scale bar visible in bottom-left
- No console errors

- [ ] **Step 3: Verify color update performance**

Drag the colorMin or colorMax slider rapidly.

Expected: color update feels instantaneous (no janky frame drops). This confirms GPU compute is running instead of the 500k-iteration CPU loop.

- [ ] **Step 4: Verify arrows at high zoom**

Zoom in past the LOD threshold (zoom 5+). Expected: colored arrow polygons appear, pointing in overlay directions.

- [ ] **Step 5: Verify die click still works**

Click a data point. Expected: `DieInfoPanel` shows the die's coordinates.

- [ ] **Step 6: Check browser DevTools for WebGPU usage**

Open Chrome DevTools → Performance tab → record 2 seconds while dragging colorMin slider.

Expected: GPU tasks visible in the GPU lane, no large JS blocks during slider drag.

- [ ] **Step 7: Commit any fixes**

If any API calls needed adjustment (e.g., luma.gl buffer handle access, deck.gl `device` prop name), commit those fixes:

```bash
git add -p
git commit -m "fix: adjust luma.gl API calls after browser verification"
```

---

## Known API Verification Points

These spots may need minor adjustment depending on exact luma.gl 9.3 internal API:

| Location | Uncertainty | How to verify |
|----------|-------------|---------------|
| `positionCompute.ts:21` | `(buffer as any).handle` to get raw GPUBuffer | Log `Object.keys(lumaBuffer)` in browser |
| `WaferMapView.tsx` | `device={getDevice()}` prop on DeckGL | Check deck.gl 9.3 type definitions for `DeckGLProps.device` |
| `ArrowLayer.ts:draw` | `model.draw(renderPass, {vertexCount, uniforms})` signature | Check @luma.gl/engine 9.3 `Model.draw` types |
| `ArrowLayer.ts` | `extends Layer<ArrowLayerProps>` generic type constraint | Check if deck.gl v9 `Layer` accepts a generic props type |
| `ArrowLayer.ts:updateState` | `model.setAttributes({name: lumaBuffer})` | Check if luma.gl v9 uses `setAttributes` or `setBindings` for vertex buffers |
| `ScatterplotLayer` | `{buffer: gpuBuffers.positionBuffer, size: 2}` binary attr | Verify deck.gl 9.3 accepts luma.gl `Buffer` object directly |
