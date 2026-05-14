import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {luma} from '@luma.gl/core';
import {webgpuAdapter} from '@luma.gl/webgpu';
import App from './App';
import './index.css';

// Register WebGPU adapter so DeckGL can create a WebGPU device with its canvas
luma.registerAdapters([webgpuAdapter]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
