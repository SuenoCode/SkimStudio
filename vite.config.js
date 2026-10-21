import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  worker: { format: 'es' },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'es2022',
    rollupOptions: { input: { main: resolve('index.html'), presetDemo: resolve('caption-presets-demo.html') } }
  }
});
