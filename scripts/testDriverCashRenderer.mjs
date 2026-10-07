import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react(),{name:'cash-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__cash-test'))return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__cash-test','<!doctype html><html lang="ro"><body><div id="root"></div><script type="module" src="/scripts/fixtures/driverCash.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:5179,strictPort:true,fs:{strict:false}}});
await server.listen();let browser;
try {
 const {chromium}=createRequire(import.meta.url)(process.env.VR_HUB_PLAYWRIGHT_MODULE||'playwright');
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5179/')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5179/__cash-test');await page.getByText('Credit deja utilizat.').waitFor();await page.getByText(/trebuie regenerat/).waitFor();
 await page.locator('summary').click();await page.getByRole('button',{name:'Corectează încasarea',exact:true}).click();
 const dialog=page.getByRole('dialog');const field=dialog.getByLabel('Suma totală corectă (£)');assert.equal(await field.inputValue(),'125.50');
 await field.fill('12.345');await dialog.getByRole('button',{name:'Salvează modificările'}).click();await page.getByRole('alert').filter({hasText:'maximum două zecimale'}).waitFor();assert.equal(await page.evaluate(()=>window.__cashTest.calls.length),0);
 await field.fill('82.75');await dialog.getByRole('button',{name:'Salvează modificările'}).click();assert.equal(await field.isDisabled(),true);await page.getByRole('alert').filter({hasText:'Conflict de versiune'}).waitFor();assert.equal(await field.inputValue(),'82.75');
 assert.deepEqual(await page.evaluate(()=>window.__cashTest.calls[0]),{rootId:'root',amount:82.75,expectedRevision:4});
 await page.evaluate(()=>window.__cashTest.setFail(false));await field.fill('0');await dialog.getByRole('button',{name:'Salvează modificările'}).click();await dialog.waitFor({state:'hidden'});await page.getByText(/Fără încasare/).waitFor();
 await page.goto('http://127.0.0.1:5179/__cash-test?role=viewer');await page.locator('summary').click();await page.getByText(/Șofer test/).waitFor();assert.equal(await page.getByRole('button').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS driver cash renderer: decimal validation, original revision, pending lock, conflict preserves form, coordinated zero and Viewer read-only');
}finally{await browser?.close();await server.close();}
