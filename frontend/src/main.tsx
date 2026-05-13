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
