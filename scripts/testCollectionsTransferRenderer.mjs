import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react(),{name:'collections-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__collections'))return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__collections','<!doctype html><html lang="ro"><body><div id="root"></div><script type="module" src="/scripts/fixtures/collectionsTransfer.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:5187,strictPort:true,fs:{strict:false}}});
await server.listen();let browser;
try {
 const {chromium}=createRequire(import.meta.url)(process.env.VR_HUB_PLAYWRIGHT_MODULE||'playwright');
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:5187/')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5187/__collections');await page.getByLabel('Șofer',{exact:true}).selectOption('1');await page.getByText('£42.50').waitFor();
 await page.screenshot({path:'/private/tmp/hub-driver-collections.png'});
 await page.getByLabel('Șofer',{exact:true}).selectOption('2');await page.getByText(/Nu există încasări/).waitFor();assert.equal(await page.getByText('Magazin A',{exact:true}).count(),0);
 await page.evaluate(()=>window.__collections.fail=true);await page.getByLabel('Șofer',{exact:true}).selectOption('1');await page.getByRole('alert').waitFor();
 await page.evaluate(()=>window.__collections.fail=false);await page.getByRole('button',{name:'Reîncearcă'}).click();await page.getByText('£42.50').waitFor();
 await page.getByRole('button',{name:'Transfer test'}).click();const modal=page.getByRole('dialog');await modal.getByText(/Credit aplicat £20.00/).waitFor();await modal.getByText('£50.00',{exact:true}).waitFor();
 assert.equal(await modal.getByLabel('Suma plătită cu cardul').count(),0);
 await modal.getByRole('button',{name:'Confirmă transferul',exact:true}).click();await modal.getByText(/Factura TGB-42 este/).waitFor();
 assert.equal((await page.evaluate(()=>window.__collections.calls))[0].amount,0);await modal.getByRole('button',{name:'Închide',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Transfer test'}).click();await modal.getByText(/Credit aplicat/).waitFor();
 await modal.getByLabel('Înregistrează și o încasare cu cardul').check();assert.equal(await modal.getByLabel('Suma plătită cu cardul').inputValue(),'50');
 await modal.getByLabel('Suma plătită cu cardul').fill('51');assert.equal(await modal.getByRole('button',{name:'Confirmă încasarea și transferul',exact:true}).isDisabled(),true);
 await modal.getByLabel('Suma plătită cu cardul').fill('40');await modal.getByLabel('Banca',{exact:true}).selectOption('HSBC');await modal.getByLabel('Referința tranzacției').fill('test-card');
 await page.screenshot({path:'/private/tmp/hub-transfer-credit-mobile.png'});
 await modal.getByRole('button',{name:'Confirmă încasarea și transferul',exact:true}).click();await modal.getByText(/Factura TGB-42 este/).waitFor();
 assert.equal((await page.evaluate(()=>window.__collections.calls))[1].amount,40);assert.deepEqual(errors,[]);
 console.log('PASS: report selection, empty/error/retry, credit preview, transfer without payment, optional card bounds, desktop/mobile rendering.');
}finally{await browser?.close();await server.close();}
