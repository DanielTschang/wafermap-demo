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
