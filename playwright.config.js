import {defineConfig} from '@playwright/test';
const production=process.env.SKIMSTUDIO_TEST_PRODUCTION==='1';
const port=production?4180:5180,url='http://127.0.0.1:'+port;
// Own Vite in-process so cleanup does not depend on Windows taskkill permissions.
export default defineConfig({testDir:'./tests',testMatch:['browser.spec.js','presets.browser.spec.js','caption-presets.browser.spec.js','ai.browser.spec.js'],workers:1,use:{channel:'chrome',headless:true,baseURL:url},globalSetup:'./scripts/browser-test-server.mjs'});
