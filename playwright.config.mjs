import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./test/browser',use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1100,height:850},launchOptions:{args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
 webServer:{command:'node examples/progressive/server.mjs',url:'http://127.0.0.1:4173/',reuseExistingServer:!process.env.CI},
 timeout:45000
});
