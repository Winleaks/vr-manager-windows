// Native Windows lifecycle check with an empty window and no business database/API.
const {app,BrowserWindow,Tray,Menu,nativeImage}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const Module=require('node:module');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../electron/device/appLifecycle.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod=new Module(__filename);mod._compile(code,__filename);
const {createAppLifecycle}=mod.exports;
let window, tray, allowed=true, cleanup=0, passed=false;
const lifecycle=createAppLifecycle({confirmClose:()=>allowed,canHideToTray:()=>!!tray&&!tray.isDestroyed(),getWindow:()=>window,
 createWindow:()=>{window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});window.on('close',e=>lifecycle.windowClose(e));},
 quit:()=>app.quit(),cleanup:[()=>{cleanup++;tray?.destroy();}],reportError:e=>{throw e;}});
app.on('before-quit',e=>lifecycle.beforeQuit(e));
app.on('will-quit',()=>{lifecycle.willQuit();assert.equal(cleanup,1);assert.equal(passed,true);console.log('PASS: native Windows tray hide/reopen/cancel/quit');});
app.on('window-all-closed',()=>{});
const watchdog=setTimeout(()=>{console.error('Tray smoke timeout');app.exit(1);},20000);watchdog.unref();
app.whenReady().then(()=>{
 assert.equal(process.platform,'win32');
 const icon=nativeImage.createFromPath(path.join(__dirname,'../dist/tray-icon.png'));assert.equal(icon.isEmpty(),false);
 tray=new Tray(icon);tray.setToolTip('Baker Hub test');
 const menu=Menu.buildFromTemplate([{label:'Deschide Baker Hub',click:()=>lifecycle.reopen()},{label:'Închide definitiv',click:()=>app.quit()}]);tray.setContextMenu(menu);
 lifecycle.ready();lifecycle.reopen();assert.equal(window.isVisible(),true);
 window.close();assert.equal(window.isDestroyed(),false);assert.equal(window.isVisible(),false);assert.equal(cleanup,0);
 menu.items[0].click();assert.equal(window.isVisible(),true);
 allowed=false;menu.items[1].click();assert.equal(window.isDestroyed(),false);assert.equal(cleanup,0);
 allowed=true;passed=true;menu.items[1].click();
}).catch(e=>{console.error(e);app.exit(1);});
