import { defineConfig, loadEnv } from 'vite';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createAIGateway} from './server/aiGateway.js';
const require=createRequire(import.meta.url);
// npm may hoist dependencies outside this extracted workspace. Allow only the
// bundled font package, not its parent filesystem, in the development server.
export default defineConfig(({mode})=>{
  // loadEnv stays in Vite's Node config; never pass these values to define/envPrefix.
  const env={...loadEnv(mode,process.cwd(),''),...process.env};
  const middleware=createAIGateway({env});
  return {
    plugins:[{name:'skimstudio-local-ai',configureServer(server){server.middlewares.use(middleware)},configurePreviewServer(server){server.middlewares.use(middleware)}}],
    server:{host:'127.0.0.1',watch:{ignored:['**/.cache/**','**/test-results/**']},fs:{allow:[resolve('.'),dirname(require.resolve('@fontsource/montserrat/package.json'))]}},
    preview:{host:'127.0.0.1'},worker:{format:'es'},
    build:{outDir:'dist',target:'es2022',rollupOptions:{input:{main:resolve('index.html'),enhanced:resolve('SkimStudio_Enhanced.html')}}}
  };
});
