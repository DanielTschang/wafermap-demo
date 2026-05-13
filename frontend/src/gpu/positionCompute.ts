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
