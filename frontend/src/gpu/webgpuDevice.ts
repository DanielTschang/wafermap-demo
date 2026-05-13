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
