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
