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
