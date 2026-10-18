import {defineConfig} from '@playwright/test';
const production=process.env.SKIMSTUDIO_TEST_PRODUCTION==='1';
const port=production?4180:5180,url='http://127.0.0.1:'+port;
const npm=process.platform==='win32'?'npm.cmd':'npm';
export default defineConfig({testDir:'./tests',testMatch:['browser.spec.js','presets.browser.spec.js'],workers:1,use:{channel:'chrome',headless:true,baseURL:url},webServer:{command:npm+' run '+(production?'preview':'dev')+' -- --port '+port+' --strictPort',url,reuseExistingServer:false}});
