const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const output=process.env.LOFT_TEST_OUTPUT||path.join(process.cwd(),'checks','output');fs.mkdirSync(output,{recursive:true});
(async()=>{
const server=http.createServer((req,res)=>{let file=path.join(process.cwd(),decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));try{let data=fs.readFileSync(file);if(file.endsWith('index.html'))data=Buffer.from(data.toString().replace(/\}\)\(\);\s*<\/script>\s*<\/body>/,'window.TEST={openApp,closeApp,DB,REG,mediaStore,openDB,showHome};})();</script></body>'));res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const bin=process.env.LOFT_BROWSER_BINARY;
const browser=await chromium.launch({headless:true,...(bin?{executablePath:bin,args:['--no-sandbox','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-zygote']}: {})});
try{
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
await page.evaluate(async()=>{
 if(!window.TEST)throw Error('Test bridge missing');const db=await TEST.openDB(),blob=await(await fetch('/photos/0-portrait.jpg')).blob(),video=new Blob([await(await fetch('/checks/fixtures/gesture.webm')).arrayBuffer()],{type:'video/webm'});
 await new Promise((resolve,reject)=>{const t=db.transaction('media','readwrite');for(let i=0;i<300;i++)t.objectStore('media').put({id:'photo-'+i,name:'Photo '+i+'.jpg',kind:'image',type:'image/jpeg',createdAt:300-i,size:blob.size,blob,thumb:blob});t.objectStore('media').put({id:'video-test',name:'Sample video.webm',kind:'video',type:'video/webm',createdAt:298.5,size:video.size,blob:video,thumb:blob});t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 window.__gets=[];const get=TEST.mediaStore.get;TEST.mediaStore.get=async id=>{__gets.push(id);return get(id);};TEST.showHome();TEST.openApp('photos');});
await page.waitForSelector('.media-tile img');assert((await page.locator('.media-tile').count())<100);
await page.getByRole('button',{name:'New album',exact:true}).click();await page.getByLabel('New album name').fill('Family');await page.getByRole('button',{name:'Create',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.photo-count')?.textContent.startsWith('0 items'));
await page.getByLabel('Album',{exact:true}).selectOption('');await page.waitForSelector('.media-tile');await page.getByRole('button',{name:'Select',exact:true}).click();await page.locator('.media-tile').nth(0).click();await page.locator('.media-tile').nth(1).click();await page.getByRole('button',{name:'Move to Album',exact:true}).click();await page.getByLabel('Destination album').selectOption({label:'Family'});await page.getByRole('button',{name:'Move',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByLabel('Album',{exact:true}).selectOption({label:'Family'});await page.waitForFunction(()=>document.querySelectorAll('.media-tile').length===2);
await page.screenshot({path:path.join(output,'loft-album.png')});
await page.locator('.media-tile').first().click();await page.waitForSelector('.media-page img');
const stage=page.locator('.media-stage'),bounds=await stage.boundingBox();
const cdp=await page.context().newCDPSession(page);
async function gesture(dx,dy){const x=bounds.x+bounds.width*.7,y=bounds.y+bounds.height*.4;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});const transform=await page.locator('.media-page[aria-hidden=false]').evaluate(e=>e.style.transform);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});return transform;}

assert.match(await gesture(-180,0),/-180px/);await page.waitForTimeout(500);await page.waitForFunction(()=>document.querySelector('.viewer-title')?.textContent.includes('2 / 2'));assert(await page.getByRole('button',{name:'Next ›',exact:true}).isDisabled());
await gesture(-160,0);await page.waitForTimeout(300);assert((await page.locator('.viewer-title').textContent()).includes('2 / 2'));
await gesture(0,15);await page.waitForTimeout(300);assert(await page.locator('.media-viewer').count());await page.screenshot({path:path.join(output,'loft-viewer.png')});
await gesture(0,220);await page.waitForFunction(()=>!document.querySelector('.media-viewer'));assert.equal(await page.locator('.media-tile').count(),2);
// Reopen the whole page: membership must remain in IDB.
await page.reload();await page.evaluate(()=>{TEST.showHome();TEST.openApp('photos');});await page.getByLabel('Album',{exact:true}).selectOption({label:'Family'});await page.waitForFunction(()=>document.querySelectorAll('.media-tile').length===2);
await page.getByLabel('Album',{exact:true}).selectOption('');await page.waitForSelector('.media-tile img');await page.waitForTimeout(100);
await page.getByRole('button',{name:'Sample video.webm',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-page[aria-hidden=false] video')?.readyState>=1);assert(await page.locator('.media-page[aria-hidden=false] video').evaluate(v=>v.controls&&v.playsInline));await gesture(-180,0);await page.waitForFunction(()=>!document.querySelector('.viewer-title').textContent.includes('Sample video'));await page.getByRole('button',{name:'Done',exact:true}).click();
await page.getByRole('button',{name:'Sample video.webm',exact:true}).click();await page.waitForSelector('.media-page[aria-hidden=false] video');await gesture(0,220);await page.waitForFunction(()=>!document.querySelector('.media-viewer'));
await page.evaluate(()=>{window.__cacheReads=[];const get=TEST.mediaStore.get;TEST.mediaStore.get=async id=>{__cacheReads.push(id);return get(id);};});

await page.locator('.photo-scroll').evaluate(e=>{e.scrollTop=2000;});await page.waitForTimeout(150);await page.locator('.photo-scroll').evaluate(e=>{e.scrollTop=0;});await page.waitForSelector('.media-tile img');assert((await page.locator('.media-tile').count())<100);
assert.equal(await page.evaluate(()=>__cacheReads.filter(x=>x==='photo-0').length),0,'scrolling back must reuse cached preview');assert.deepEqual(errors,[]);console.log('PASS: 390px mobile layout, create/move/filter albums, reopen persistence, horizontal paging, end boundary, downward snap-back and dismiss for photos and videos, virtual grid and cached thumbnails.');
}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
