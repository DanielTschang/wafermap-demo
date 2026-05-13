import {Layer} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {LayerProps, UpdateParameters} from '@deck.gl/core';
import type {RenderPass, Buffer} from '@luma.gl/core';

// WGSL shader — single source string for luma.gl WebGPU backend.
// Vertex attributes: @location(0) position (float32x2), @location(1) color (unorm8x4)
// Uniform at @group(0) @binding(0): view-projection mat4x4<f32>
const WGSL_SOURCE = /* wgsl */`
struct Uniforms {
  viewProjectionMatrix: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn vs(
  @location(0) pos: vec2<f32>,
  @location(1) col: vec4<f32>,
) -> VertexOutput {
  var out: VertexOutput;
  out.position = uniforms.viewProjectionMatrix * vec4<f32>(pos.x, pos.y, 0.0, 1.0);
  out.color = col;
  return out;
}

@fragment
fn fs(in: VertexOutput) -> @location(0) vec4<f32> {
  return in.color;
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

    // Create a 64-byte uniform buffer for the 4x4 view-projection matrix
    const uniformBuf = device.createBuffer({
      byteLength: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const model = new Model(device, {
      id: `${this.props.id}-model`,
      source: WGSL_SOURCE,
      topology: 'triangle-list',
      bufferLayout: [
        {name: 'pos', format: 'float32x2'},
        {name: 'col', format: 'unorm8x4'},
      ],
    });

    // Bind the uniform buffer by the WGSL variable name
    model.setBindings({uniforms: uniformBuf});

    this.setState({model, uniformBuf});
  }

  updateState({props, oldProps}: UpdateParameters<this>): void {
    const {model} = this.state as {model: Model; uniformBuf: Buffer};
    const buffersChanged =
      props.vertexBuffer !== oldProps.vertexBuffer ||
      props.colorBuffer  !== oldProps.colorBuffer;
    if (buffersChanged && props.vertexBuffer && props.colorBuffer) {
      model.setAttributes({
        pos: props.vertexBuffer,
        col: props.colorBuffer,
      });
    }
  }

  draw({renderPass}: {renderPass: RenderPass}): void {
    const {model, uniformBuf} = this.state as {model: Model; uniformBuf: Buffer};
    const {vertexBuffer, colorBuffer, vertexCount} = this.props;
    if (!vertexBuffer || !colorBuffer || vertexCount <= 0) return;

    // Upload the current view-projection matrix into the uniform buffer
    const vpMatrix = this.context.viewport.viewProjectionMatrix as number[];
    const {device} = this.context;
    (device as any).handle.queue.writeBuffer(
      (uniformBuf as any).handle,
      0,
      new Float32Array(vpMatrix),
    );

    model.setVertexCount(vertexCount);
    model.draw(renderPass);
  }

  finalizeState(): void {
    const {model, uniformBuf} = this.state as {model: Model; uniformBuf: Buffer};
    model?.destroy();
    uniformBuf?.destroy();
  }
}
