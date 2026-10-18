import { defineConfig } from 'vite';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// npm may hoist dependencies outside this extracted workspace. Allow only the
// bundled font package, not its parent filesystem, in the development server.
export default defineConfig({server:{fs:{allow:[resolve('.'),dirname(require.resolve('@fontsource/montserrat/package.json'))]}},worker:{format:'es'},build: { outDir: 'dist', target: 'es2022', rollupOptions:{input:{main:resolve('index.html'),enhanced:resolve('SkimStudio_Enhanced.html')}} } });
