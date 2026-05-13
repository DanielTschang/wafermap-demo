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
