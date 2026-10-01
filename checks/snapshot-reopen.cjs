const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),fs=require('fs'),assert=require('assert/strict'),crypto=require('crypto');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const db=await new Promise(resolve=>{const r=new IDBFactory().open('reopen',2);r.onupgradeneeded=()=>['media','notes','chats','contacts','albums','kv'].forEach(n=>r.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));r.onsuccess=()=>resolve(r.result);});
await new Promise(resolve=>{const t=db.transaction(['media','albums'],'readwrite');t.objectStore('albums').put({id:'family',name:'Family'});for(let i=0;i<2;i++)t.objectStore('media').put({id:'m'+i,name:'media '+i,albumId:'family',blob:new Blob([new Uint8Array(1500000)])});t.oncomplete=resolve;});
const parts=new Map(),uploads=[];let loss=true,manifest,lock=false;
function device(){const dom=new JSDOM('<main></main>',{url:'https://loft.test',runScripts:'outside-only'}),w=dom.window;let online=true;w.Response=Response;w.Blob=Blob;w.AbortSignal=AbortSignal;Object.defineProperty(w,'crypto',{value:crypto.webcrypto});w.setInterval=()=>0;Object.defineProperty(w.navigator,'onLine',{get:()=>online});Object.defineProperty(w.navigator,'locks',{value:{request:async(n,o,fn)=>{if(lock)return fn(null);lock=true;try{return await fn({});}finally{lock=false;}}}});
 w.fetch=async(url,opts={})=>{if(!online)throw Error('Offline');const u=new URL(url,'https://loft.test'),a=u.searchParams.get('action'),part=+u.searchParams.get('part');const json=x=>new Response(JSON.stringify(x));
  if(a==='config')return json({url:'https://example.supabase.co',publishableKey:'public'});if(u.pathname==='/auth/v1/token')return json({access_token:'a',refresh_token:'r',expires_in:3600});if(a==='session')return json({owner:true});
  if(a==='list')return json({items:[],cursor:null});
  if(a==='shared-status'){const b=parts.get(u.searchParams.get('hash'));return json(b?{exists:true,size:b.length,hash:u.searchParams.get('hash')}:{exists:false});}
  if(a==='shared-put'){const body=JSON.parse(opts.body),b=Buffer.from(body.data,'base64');parts.set(body.hash,b);uploads.push(body.hash);if(loss){loss=false;online=false;throw Error('Lost response');}return json({saved:true});}
  if(a==='part-status'){const b=parts.get(part);return json(b?{exists:true,size:b.length,hash:crypto.createHash('sha256').update(b).digest('hex')}:{exists:false});}
  if(a==='part'){const b=Buffer.from(JSON.parse(opts.body).data,'base64');parts.set(part,b);uploads.push(part);if(part===2&&loss){loss=false;online=false;throw Error('Lost response');}return json({saved:true});}
  if(a==='commit'){manifest=JSON.parse(opts.body);return json({saved:true});}throw Error(a);
 };
 for(const name of ['snapshot-transfer.js','snapshot-job.js','cloud.js'])w.eval(fs.readFileSync(name,'utf8'));
 const bridge={openDB:async()=>db,canSync:()=>false,refresh(){}};return {w,dom,bridge};}
let d=device();d.w.LoftCloud.mount(d.w.document.querySelector('main'),d.bridge);const form=d.w.document.querySelector('form');form.querySelector('[type=email]').value='owner@example.com';form.querySelector('[type=password]').value='test';form.dispatchEvent(new d.w.Event('submit',{cancelable:true}));await pause(30);[...d.w.document.querySelectorAll('button')].find(b=>b.textContent==='Save snapshot').click();
for(let i=0;i<300;i++){if(d.w.document.body.textContent.includes('Lost response'))break;await pause(10);}
assert(d.w.document.body.textContent.includes('Lost response'));d.dom.window.close();
// Fresh JS context, same persisted database, no new click and no login entry.
d=device();await d.w.LoftCloud.init(d.bridge);assert(manifest);assert.equal(manifest.records.length,3);assert.equal(uploads.length,2,'two unique chunks shared across both identical media; lost response is not resent');assert.equal(new Set(uploads).size,2);assert(manifest.records.some(r=>r.store==='albums'));assert(d.w.LoftCloud.status().signedIn);d.dom.window.close();db.close();console.log('PASS: app termination + fresh context automatically restores pending session/job; completed media/chunks are not uploaded twice; album metadata included.');
})().catch(e=>{console.error(e);process.exit(1);});
