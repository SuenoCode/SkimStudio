import {defineConfig} from '@playwright/test';
const production=process.env.SKIMSTUDIO_TEST_PRODUCTION==='1';
const url=production?'http://127.0.0.1:4173':'http://127.0.0.1:5173';
export default defineConfig({testDir:'./tests',testMatch:'browser.spec.js',workers:1,use:{channel:'chrome',headless:true,baseURL:url},webServer:{command:production?'npm run preview -- --port 4173':'npm run dev',url,reuseExistingServer:true}});
