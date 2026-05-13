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
