const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {fixture}=require('./shared-fixture.cjs'),{sharedMedia}=require('../lib/shared-media'),{transfer}=require('../lib/manifest-transfer');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const f=fixture(),old='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',prefix='owner/',oldBytes=Buffer.from('already saved original'),oldHash=f.hash(oldBytes);
 f.seed(prefix+'parts/'+old+'/0',oldBytes,{sha256:oldHash});
 f.seed(prefix+'commits/'+old+'.json',JSON.stringify({version:1,parts:1,records:[{store:'media',value:['blob',{type:'image/jpeg',size:oldBytes.length,parts:[{number:0,hash:oldHash}]}]}]}));
 const db=await new Promise(resolve=>{const q=new IDBFactory().open('ui',2);q.onupgradeneeded=()=>['media','notes','contacts','chats','albums','kv'].forEach(n=>q.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));q.onsuccess=()=>resolve(q.result);});
 await new Promise(resolve=>{const t=db.transaction('media','readwrite');t.objectStore('media').put({id:'old',name:'old.jpeg',blob:new Blob([oldBytes],{type:'image/jpeg'})});t.objectStore('media').put({id:'new',name:'new.jpeg',blob:new Blob(['new original'],{type:'image/jpeg'})});t.oncomplete=resolve;});
 const dom=new JSDOM('<main></main>',{url:'https://loft.test',runScripts:'outside-only'}),w=dom.window;
 try{
 w.Response=Response;w.Blob=Blob;w.AbortSignal=AbortSignal;Object.defineProperty(w,'crypto',{value:webcrypto});w.setInterval=()=>0;Object.defineProperty(w.navigator,'locks',{value:{request:async(n,o,fn)=>fn({})}});let uploads=0;
 w.fetch=async(url,o={})=>{const u=new URL(url,'https://loft.test'),action=u.searchParams.get('action'),id=u.searchParams.get('id'),query=Object.fromEntries(u.searchParams),body=o.body?JSON.parse(o.body):undefined,json=value=>new Response(JSON.stringify(value));
  if(action==='config')return json({url:'https://auth.test',publishableKey:'public'});
  if(u.pathname==='/auth/v1/token')return json({access_token:'a',refresh_token:'r',expires_in:3600});
  if(action==='session')return json({owner:true});
  if(action==='list')return json({items:[...f.objects.keys()].filter(k=>k.startsWith(prefix+'commits/')).map(k=>({id:k.slice((prefix+'commits/').length,-5)})),cursor:null});
  if(action.startsWith('index-'))return json(await transfer({s3:f.s3,Bucket:'b',prefix,id,action,query,body,method:o.method}));
  if(action.startsWith('shared-')){if(action==='shared-put')uploads++;const r=await sharedMedia({s3:f.s3,Bucket:'b',prefix,action,query,body,method:o.method});return Buffer.isBuffer(r)?new Response(r):json(r);}
  if(action==='commit'){f.seed(prefix+'commits/'+id+'.json',JSON.stringify(body));return json({saved:true});}
  throw Error(action);
 };
 for(const name of ['snapshot-transfer.js','snapshot-job.js','cloud.js'])w.eval(fs.readFileSync(name,'utf8'));
 w.LoftCloud.mount(w.document.querySelector('main'),{openDB:async()=>db,canSync:()=>false,refresh(){}});
 const button=label=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);
 const wait=async text=>{for(let i=0;i<400;i++){if(w.document.body.textContent.includes(text)&&!button('Save snapshot')?.disabled)return;await delay(5);}throw Error('Missing '+text+'; '+w.document.body.textContent);};
 await delay(10);w.document.querySelector('[type=email]').value='owner@example.com';w.document.querySelector('[type=password]').value='password';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait('Signed in.');await delay(30);
 button('Save snapshot').click();await wait('Saved 2 records');assert.equal(uploads,1);assert.equal(f.copies.length,1);assert(w.document.body.textContent.includes('Reused:'));
 button('Save snapshot').click();await delay(30);await wait('Saved 2 records');assert.equal(uploads,1);assert.equal(f.copies.length,1);
 console.log('PASS: Cloud UI discovers legacy backup metadata, promotes original within storage, uploads only new media, shows reuse metrics, and reuses both on another save.');
 }finally{dom.window.close();db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
