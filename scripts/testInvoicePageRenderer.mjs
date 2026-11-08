import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react(),{name:'invoice-fixture',configureServer(v){v.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__invoices'))return next();res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml('/__invoices','<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/invoicePage.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
await server.listen();let browser;
try{
 const {chromium}=createRequire(import.meta.url)(process.env.VR_HUB_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+'__invoices');
 const search=page.getByPlaceholder(/Caut/);
 await search.fill('immediate');await page.getByText('#immediate',{exact:true}).waitFor();
 await search.fill('');await page.getByText('#TEST-1',{exact:true}).waitFor();assert.equal(await page.locator('tbody tr').count(),50);
 await page.getByRole('button',{name:'Înainte',exact:true}).click();await page.getByText('#TEST-51',{exact:true}).waitFor();
 await search.fill('slow');await page.waitForFunction(()=>window.__invoices.calls.some(q=>q.search==='slow'));await search.fill('latest');await page.getByText('#latest',{exact:true}).waitFor();await page.waitForTimeout(850);assert.equal(await page.getByText('#slow',{exact:true}).count(),0);
 await page.evaluate(()=>window.__invoices.fail=true);await search.fill('failure');await page.getByRole('alert').waitFor();await page.evaluate(()=>window.__invoices.fail=false);await page.getByRole('button',{name:'Reîncearcă'}).click();await page.getByText('#failure',{exact:true}).waitFor();
 await page.evaluate(()=>window.__testExports());const exports=await page.evaluate(()=>window.__invoices.exports);assert.equal(exports.length,2);assert.deepEqual(exports[0].bytes.slice(0,2),[80,75]);assert.deepEqual(exports[1].bytes.slice(0,4),[37,80,68,70]);
 await page.screenshot({path:'/private/tmp/hub-invoices-paged.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: initial search, 50-row pages, full search, stale response rejection and error retry.');
}finally{await browser?.close();await server.close();}
