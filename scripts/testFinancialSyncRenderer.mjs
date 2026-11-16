import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const server=await createServer({configFile:false,plugins:[react(),{name:'financial-sync-fixture',configureServer(v){v.middlewares.use(async(req,res,next)=>{if(!req.url?.startsWith('/__sync'))return next();res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml('/__sync','<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/financialSync.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
await server.listen();let browser;
try{const {chromium}=createRequire(import.meta.url)(process.env.VR_HUB_PLAYWRIGHT_MODULE||'playwright');browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+'__sync');const banner=page.locator('aside');await banner.getByText('Modificările financiare sunt sincronizate cu platforma clienților.').waitFor();
 await page.evaluate(()=>window.__sync.mode='blocked');await banner.getByText(/corectarea asocierii/).waitFor({timeout:8000});await page.getByText('Magazine afectate: Magazin test').waitFor();await page.screenshot({path:'/private/tmp/hub-sync-association.png',fullPage:true});
 await banner.getByRole('button',{name:'Reîncearcă sincronizarea'}).click();await banner.getByText('Modificările financiare sunt sincronizate cu platforma clienților.').waitFor();assert.equal(await page.evaluate(()=>window.__sync.calls),1);
 await page.evaluate(()=>window.__sync.mode='running');await banner.getByText('Sincronizarea financiară este în curs…').waitFor({timeout:8000});
 await page.evaluate(()=>window.__sync.mode='temporary');await banner.getByText(/Reîncercare automată/).waitFor({timeout:8000});assert.deepEqual(errors,[]);console.log('PASS: clean/blocked/running/transient states, affected stores, latest confirmation and manual retry refresh.');
}finally{await browser?.close();await server.close();}
