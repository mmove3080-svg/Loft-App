const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),fs=require('fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const {fixture}=require('./shared-fixture.cjs'),{sharedMedia}=require('../lib/shared-media'),{transfer}=require('../lib/manifest-transfer');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<600;i++){if(await fn())return;await delay(5);}throw Error('Timed out');};
(async()=>{
 const f=fixture(),old='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',prefix='owner/',oldBytes=Buffer.from('already saved original'),oldHash=f.hash(oldBytes);
 f.seed(prefix+'parts/'+old+'/0',oldBytes,{sha256:oldHash});
 f.seed(prefix+'commits/'+old+'.json',JSON.stringify({version:1,parts:1,records:[{store:'media',value:['blob',{type:'image/jpeg',size:oldBytes.length,parts:[{number:0,hash:oldHash}]}]}]}));
 const db=await new Promise(resolve=>{const q=new IDBFactory().open('controls',2);q.onupgradeneeded=()=>['media','notes','contacts','chats','albums','kv'].forEach(n=>q.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));q.onsuccess=()=>resolve(q.result);});
 const read=key=>new Promise(resolve=>{db.transaction('kv').objectStore('kv').get(key).onsuccess=e=>resolve(e.target.result);});
 const write=fn=>new Promise((resolve,reject)=>{const t=db.transaction('kv','readwrite');fn(t.objectStore('kv'));t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 let uploads=0,held=false,hold=true,statusHold=false,statusHeld=false,requests=0,promotionFails=false;
 const devices=[];
 function device(){
  const dom=new JSDOM('<main></main>',{url:'https://loft.test',runScripts:'outside-only'}),w=dom.window;devices.push(w);
  w.Blob=Blob;w.Response=Response;w.AbortSignal=AbortSignal;w.AbortController=AbortController;Object.defineProperty(w,'crypto',{value:webcrypto});w.setInterval=()=>0;Object.defineProperty(w.navigator,'locks',{value:{request:async(n,o,fn)=>fn({})}});
  w.fetch=async(url,o={})=>{const u=new URL(url,'https://loft.test'),action=u.searchParams.get('action'),id=u.searchParams.get('id'),query=Object.fromEntries(u.searchParams),body=o.body?JSON.parse(o.body):undefined,json=value=>new Response(JSON.stringify(value));requests++;
   if(action==='config')return json({url:'https://auth.test',publishableKey:'public'});
   if(u.pathname==='/auth/v1/token')return json({access_token:'a',refresh_token:'r',expires_in:3600});
   if(u.pathname==='/auth/v1/logout')return json({});
   if(action==='session')return json({owner:true});
   if(action==='list')return json({items:[...f.objects.keys()].filter(k=>k.startsWith(prefix+'commits/')).map(k=>({id:k.slice((prefix+'commits/').length,-5)})),cursor:null});
   if(action==='sync-index-info')return json({empty:true});
   if(action.startsWith('index-'))return json(await transfer({s3:f.s3,Bucket:'b',prefix,id,action,query,body,method:o.method}));
   if(action.startsWith('shared-')){
    if(action==='shared-promote'&&promotionFails)return json({saved:false});
    if(action==='shared-status'&&statusHold){statusHeld=true;return new Promise(()=>{});}
    if(action==='shared-put')uploads++;
    const r=await sharedMedia({s3:f.s3,Bucket:'b',prefix,action,query,body,method:o.method});
    // Simulate the server saving bytes, then never delivering a response, even on abort.
    if(action==='shared-put'&&hold){held=true;return new Promise(()=>{});}
    return Buffer.isBuffer(r)?new Response(r):json(r);
   }
   if(action==='commit'){f.seed(prefix+'commits/'+id+'.json',JSON.stringify(body));return json({saved:true});}
   throw Error(action);
  };
  for(const name of ['sync-engine.js','snapshot-transfer.js','snapshot-job.js','cloud.js'])w.eval(fs.readFileSync(name,'utf8'));
  const bridge={openDB:async()=>db,canSync:()=>false,refresh(){}};
  w.LoftCloud.mount(w.document.querySelector('main'),bridge);
  const button=label=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);
  const login=async()=>{w.document.querySelector('[type=email]').value='owner@example.com';w.document.querySelector('[type=password]').value='password';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>w.LoftCloud.status().signedIn&&!button('Sign out').disabled);await delay(30);};
  return {w,bridge,button,login,text:()=>w.document.body.textContent};
 }
 try{
  // Old pending job: exactly 26 successful records must survive the update.
  const encoded=Array.from({length:26},(_,i)=>({store:'notes',value:['object',[['id',['value','note'+i]]]]}));
  await write(s=>{
   s.put({id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',createdAt:new Date().toISOString(),total:28,index:26,part:0,uploaded:0,encoded,blobs:[],pending:null,last:'note25',state:'saving'},'snapshot-job-v2');
   s.put({store:'media',value:{id:'old',name:'old.jpeg',blob:new Blob([oldBytes])}},'snapshot-row-v2:26');
   s.put({store:'media',value:{id:'new',name:'new.jpeg',blob:new Blob(['new original'])}},'snapshot-row-v2:27');
  });
  let d=device();await d.login();assert.equal(uploads,0);assert.equal((await read('snapshot-job-v2')).index,26);assert(d.text().includes('Snapshot paused'));assert(await read('snapshot-paused-v1'));
  d.button('Resume snapshot').click();await until(()=>held);assert.equal(uploads,1);assert.equal(f.copies.length,1);assert.equal((await read('snapshot-job-v2')).index,27);
  for(const name of ['Sign out','Collection','Show saved snapshots','Pause snapshot'])assert(!d.button(name).disabled,name+' must remain usable');
  d.button('Collection').click();await until(()=>d.text().includes('Your cloud collection')&&!d.button('Sign out').disabled);
  d.button('Show saved snapshots').click();await until(()=>d.text().includes('Choose a snapshot')&&!d.button('Sign out').disabled);
  d.button('Pause snapshot').click();await until(()=>d.text().includes('Snapshot paused')&&d.button('Pause snapshot').hidden);
  assert.equal((await read('snapshot-job-v2')).index,27);assert(await read('snapshot-paused-v1'));assert(await read('snapshot-row-v2:27'));
  d.w.close();d=device();await d.w.LoftCloud.init(d.bridge);await delay(30);assert.equal(uploads,1);assert.equal((await read('snapshot-job-v2')).index,27);
  // A fresh sign-in and visibility/online events must not override explicit Pause.
  await d.login();d.w.dispatchEvent(new d.w.Event('online'));d.w.document.dispatchEvent(new d.w.Event('visibilitychange'));await delay(30);assert.equal(uploads,1);
  hold=false;d.button('Resume snapshot').click();await until(()=>d.text().includes('Saved 28 records')&&!d.button('Save snapshot').disabled);assert.equal(uploads,1,'lost successful upload is never sent again');
  assert.equal(await read('snapshot-job-v2'),undefined);assert.equal((await read('snapshot-last-v2')).index,28);
  // Existing new-format job automatically resumes with working buttons; sign out aborts a stalled HEAD.
  const engine=d.w.LoftSnapshotJob;
  await engine.create(db,[{store:'media',value:{id:'another',name:'another.jpeg',blob:new Blob(['another'])}}],'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await write(s=>{s.put(false,'snapshot-paused-v1');s.put({access_token:'a',refresh_token:'r',expires_at:Date.now()+3600000},'snapshot-session-v2');});
  d.w.close();d=device();statusHold=true;const started=d.w.LoftCloud.init(d.bridge);await until(()=>statusHeld);
  assert(!d.button('Sign out').disabled);assert(!d.button('Collection').disabled);
  d.button('Sign out').click();await until(()=>d.text().includes('Signed out on this page.'));await started;
  assert(!d.w.LoftCloud.status().signedIn);assert(await read('snapshot-job-v2'));assert(await read('snapshot-row-v2:0'));assert(await read('snapshot-paused-v1'));assert.equal(await read('snapshot-session-v2'),undefined);
  const before=requests;d.w.dispatchEvent(new d.w.Event('online'));await delay(30);assert.equal(requests,before);
  // A known backup that cannot be verified must never silently fall back to re-uploading it.
  statusHold=false;promotionFails=true;f.objects.delete(prefix+'shared-media/'+oldHash);
  await d.w.LoftSnapshotJob.create(db,[{store:'media',value:{id:'old-again',name:'old.jpeg',blob:new Blob([oldBytes])}}],'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  await d.login();const uploadedBefore=uploads;
  d.button('Resume snapshot').click();await until(()=>d.text().includes('Paused to avoid uploading it again.')&&!d.button('Resume snapshot').disabled);
  assert.equal(uploads,uploadedBefore);assert.equal((await read('snapshot-job-v2')).index,0);
  console.log('PASS: old 26/28 checkpoint preserved; upgrade pauses once; manual and automatic snapshot runs keep Browse/Sign out usable; persistent Pause survives reopen/login/online; unresponsive request aborts; saved lost-response bytes never re-upload; sign out preserves pending data and stops requests.');
 }finally{devices.forEach(w=>w.close());db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
