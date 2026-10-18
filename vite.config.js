import { defineConfig } from 'vite';
import {resolve} from 'node:path';
export default defineConfig({worker:{format:'es'},build: { outDir: 'dist', target: 'es2022', rollupOptions:{input:{main:resolve('index.html'),enhanced:resolve('SkimStudio_Enhanced.html')}} } });
