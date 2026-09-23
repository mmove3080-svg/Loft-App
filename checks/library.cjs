const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {syncIndex}=require('../lib/sync');
const files=new Map(),versions=new Map();let serial=0,partUploads=0;
const s3={send:async c=>{const a=c.input,n=c.constructor.name;
 if(n==='GetObjectCommand'){if(!files.has(a.Key))throw Object.assign(Error('missing'),{name:'NoSuchKey'});return {ETag:versions.get(a.Key),Body:{transformToByteArray:async()=>Buffer.from(files.get(a.Key))}};}
 if(n==='PutObjectCommand'){if((a.IfMatch&&a.IfMatch!==versions.get(a.Key))||(a.IfNoneMatch==='*'&&files.has(a.Key)))throw Object.assign(Error('changed'),{status:409});files.set(a.Key,a.Body);const ETag=String(++serial);versions.set(a.Key,ETag);return {ETag};}
 if(n==='ListObjectsV2Command')return {Contents:[...files.keys()].filter(k=>k.startsWith(a.Prefix)).slice(0,a.MaxKeys).map(Key=>({Key}))};
 if(n==='DeleteObjectsCommand'){for(const x of a.Delete.Objects){files.delete(x.Key);versions.delete(x.Key);}return {};}
 throw Error(n);
}};
const devices=[];
async function device(name){
 const dom=new JSDOM('<main></main>',{url:'https://loft.test',runScripts:'outside-only'}),w=dom.window;devices.push(dom);
 w.URL.createObjectURL=()=> 'blob:preview';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){w.lastDownload=this.download;};w.Blob=Blob;w.AbortSignal=AbortSignal;Object.defineProperty(w,'crypto',{value:webcrypto});w.confirm=()=>true;
 w.setInterval=()=>0;Object.defineProperty(w.navigator,'locks',{value:{request:async(n,o,fn)=>fn({name:n})}});
 let online=true,safe=true,race=null;Object.defineProperty(w.navigator,'onLine',{get:()=>online});
 const db=await new Promise((resolve,reject)=>{const r=new IDBFactory().open(name,1);r.onupgradeneeded=()=>['media','notes','contacts','chats','kv'].forEach(n=>r.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 w.fetch=async(url,opts={})=>{if(!online)throw Error('offline');const u=new URL(url,'https://loft.test'),a=u.searchParams.get('action'),id=u.searchParams.get('id'),part=u.searchParams.get('part');const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
 if(u.pathname==='/auth/v1/token')return json({access_token:'test',refresh_token:'refresh',expires_in:3600});
 if(a==='config')return json({url:'https://example.supabase.co',publishableKey:'public'});
 assert.equal(opts.headers.Authorization,'Bearer test');if(a==='session')return json({owner:true});
 if(['sync-index','sync-cleanup','trash-restore','trash-purge'].includes(a)){try{const answer=await syncIndex({s3,Bucket:'b',prefix:'owner/',method:opts.method,body:opts.body?JSON.parse(opts.body):undefined,cleanup:a==='sync-cleanup',operation:a==='trash-restore'?'restore':a==='trash-purge'?'purge':undefined});if(a==='sync-index'&&opts.method==='GET'&&race){const fn=race;race=null;await fn();}return json(answer);}catch(e){return json({error:e.message},e.status||503);}}
 if(a==='storage-usage')return json({totals:{sync:100,backups:200,other:0,objects:3},cursor:null});
 if(a==='sync-part'){const key='owner/sync/parts/'+id+'/'+part;if(opts.method==='POST'){files.set(key,Buffer.from(JSON.parse(opts.body).data,'base64'));partUploads++;return json({saved:true});}return new Response(files.get(key));}
 throw Error(a);
 };
 w.eval(fs.readFileSync('sync-engine.js','utf8'));w.eval(fs.readFileSync('cloud.js','utf8'));
 w.LoftCloud.mount(w.document.querySelector('main'),{openDB:async()=>db,canSync:()=>safe,refresh:()=>{}});
 const button=label=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);
 const status=()=>[...w.document.querySelectorAll('[role=status]')].map(e=>e.textContent).join('|');
 const wait=async text=>{for(let i=0;i<500;i++){if(status().includes(text)&&!button('Pause automatic sync')?.disabled)return;await new Promise(r=>setTimeout(r,5));}throw Error(name+' expected '+text+' saw '+status());};
 await new Promise(r=>setTimeout(r,10));w.document.querySelector('input[type=email]').value='owner@example.com';w.document.querySelector('input[type=password]').value='password';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait('Signed in.');
 const write=(store,value,del=false)=>new Promise((resolve,reject)=>{const tx=db.transaction([store,'kv'],'readwrite');if(del)tx.objectStore(store).delete(value);else tx.objectStore(store).put(value);const r=tx.objectStore('kv').get('sync-local-revision');r.onsuccess=()=>tx.objectStore('kv').put((r.result||0)+1,'sync-local-revision');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
 const get=(store,id)=>new Promise(r=>{const q=db.transaction(store).objectStore(store).get(id);q.onsuccess=()=>r(q.result);});
 const sync=async(text='Up to date')=>{button('Sync now').click();await new Promise(r=>setTimeout(r,30));await wait(text);};
 return {race:fn=>race=fn,w,db,button,wait,write,get,sync,online:v=>online=v,safe:v=>safe=v,status};
}
(async()=>{
 const a=await device('Library');await a.write('notes',{id:'n',text:'Shopping apples'});await a.write('contacts',{id:'c',name:'Alex',number:'12345'});await a.write('chats',{id:'m',name:'Sam',messages:[{text:'Meeting Monday',ts:Date.now()}]});await a.write('media',{id:'p',name:'test.png',blob:new Blob(['photo'],{type:'image/png'}),thumb:new Blob(['thumbnail'],{type:'image/png'})});
 a.button('Enable automatic sync').click();await a.wait('Up to date');a.button('Pause automatic sync').click();await a.wait('Automatic sync is off.');
 const waitFor=async fn=>{for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+a.status());};
 const click=async label=>{assert(a.button(label),'button '+label);a.button(label).click();await waitFor(()=>!a.button(label)?.disabled);};
 await click('Collection');assert.equal(a.w.document.querySelectorAll('.library-card').length,4);assert(a.w.document.querySelector('.library-thumb img'));
 const search=a.w.document.querySelector('input[type=search]');search.value='Monday';search.dispatchEvent(new a.w.Event('input'));await waitFor(()=>a.w.document.querySelectorAll('.library-card').length===1);assert(a.w.document.querySelector('.library-card').textContent.includes('Sam'));
 search.value='12345';search.dispatchEvent(new a.w.Event('input'));await waitFor(()=>a.w.document.querySelector('.library-card')?.textContent.includes('Alex'));
 await click('Download text');assert.equal(a.w.lastDownload,'Alex.txt');await click('Export matching records');assert.equal(a.w.lastDownload,'loft-library-export.json');
 await click('Move to Trash');await waitFor(()=>a.status().includes('Moved to Trash'));assert.equal((await a.get('contacts','c')).name,'Alex','browsing deletion does not mutate local IDB outside sync');
 await click('Trash');assert(a.button('Restore item'));assert(a.w.document.body.textContent.includes('30 more days'));
 await click('Restore item');await waitFor(()=>a.status().includes('Restored to'));assert.equal(a.w.document.querySelectorAll('.library-card').length,0);
 await click('Collection');assert.equal(a.w.document.querySelectorAll('.library-card').length,4);await click('View photo / play video');assert(a.w.document.querySelector('dialog img'));
 await click('Download original');assert.equal(a.w.lastDownload,'test.png');
 await click('Storage');assert(a.w.document.body.textContent.includes('300 B'));assert(a.w.document.body.textContent.includes('Saved backups'));
 console.log('PASS: unified search, thumbnails, media dialog, original and text downloads, export, Trash/restore, storage totals; local records preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>devices.forEach(d=>d.window.close()));
