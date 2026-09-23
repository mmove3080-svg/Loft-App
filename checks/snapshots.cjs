const {JSDOM}=require('jsdom');
const {indexedDB}=require('fake-indexeddb');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
(async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://loft.test',runScripts:'outside-only'}), w=dom.window;
 w.Blob=Blob;w.AbortSignal=AbortSignal;Object.defineProperty(w,'crypto',{value:webcrypto});w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 const manifests=new Map(), parts=new Map();let corrupt=false;
 w.fetch=async(url,opts={})=>{
  const u=new URL(url,'https://loft.test'),action=u.searchParams.get('action'),id=u.searchParams.get('id'),part=u.searchParams.get('part');
  const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/auth/v1/token')return json({access_token:'test',refresh_token:'test',expires_in:3600});
  if(action==='config')return json({url:'https://example.supabase.co',publishableKey:'public'});
  assert.equal(opts.headers.Authorization,'Bearer test');
  if(action==='session')return json({owner:true});
  if(action==='list')return json({items:[...manifests].map(([id,m])=>({id,savedAt:m.createdAt})),cursor:null});
  if(action==='part'){
   if(opts.method==='POST'){parts.set(id+'/'+part,Buffer.from(JSON.parse(opts.body).data,'base64'));return json({saved:true});}
   return new Response(corrupt?Buffer.from('broken'):parts.get(id+'/'+part));
  }
  if(action==='browse')return json({manifest:manifests.get(id),revision:'rev'});
  if(action==='remove-record'){manifests.get(id).records.splice(JSON.parse(opts.body).index,1);return json({removed:true});}
  if(action==='cleanup')return json({cursor:null});
  if(action==='delete-snapshot'){manifests.delete(id);return json({done:true});}
  if(action==='commit'){
   if(opts.method==='POST'){manifests.set(id,JSON.parse(opts.body));return json({saved:true});}
   return json(manifests.get(id));
  }
  throw new Error('Unexpected route');
 };
 w.eval(fs.readFileSync('cloud.js','utf8'));
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('test',1);r.onupgradeneeded=()=>['media','notes','contacts','chats','kv'].forEach(n=>r.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const write=fn=>new Promise((resolve,reject)=>{const t=db.transaction(['notes','media'],'readwrite');fn(t);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 await write(t=>{t.objectStore('notes').put({id:'note-1',text:'Original cloud text'});t.objectStore('media').put({id:'photo-1',name:'test.png',blob:new Blob(['media-bytes'],{type:'image/png'})});});
 w.LoftCloud.mount(w.document.querySelector('main'),{openDB:async()=>db,refresh:()=>{}});
 const button=name=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.startsWith(name));
 const wait=async text=>{for(let i=0;i<200;i++){const s=w.document.querySelector('.cloud-panel > [role=status]').textContent;if(s.includes(text)&&![...w.document.querySelectorAll('button')].some(b=>b.disabled))return;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected '+text+'; saw '+w.document.querySelector('.cloud-panel > [role=status]').textContent);};
 w.document.querySelector('input[type=email]').value='owner@example.com';w.document.querySelector('input[type=password]').value='password';w.document.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await wait('Signed in.');button('Save snapshot').click();await wait('Saved 2 records');assert.equal(manifests.size,1);assert.equal(parts.size,1);
 await write(t=>{t.objectStore('notes').put({id:'note-1',text:'Newer local text'});t.objectStore('media').delete('photo-1');});
 button('Show saved snapshots').click();await wait('Choose a snapshot');
 corrupt=true;button('Import snapshot').click();await wait('integrity check failed');
 const get=n=>new Promise(r=>{const q=db.transaction(n).objectStore(n).getAll();q.onsuccess=()=>r(q.result);});
 assert.equal((await get('notes')).length,1);assert.equal((await get('media')).length,0);
 corrupt=false;button('Import snapshot').click();await wait('Imported 2 records');
 const notes=await get('notes'),media=await get('media');assert.equal(notes.length,2);assert(notes.some(n=>n.id==='note-1'&&n.text==='Newer local text'));assert(notes.some(n=>n.text.includes('Original cloud text')));assert.equal(await media[0].blob.text(),'media-bytes');
 button('Import snapshot').click();await wait('already been imported');assert.equal((await get('notes')).length,2);

 button('Show saved snapshots').click();await wait('Choose a snapshot');
 button('Browse contents').click();await wait('Browsing 2 items');
 assert(w.document.body.textContent.includes('Original cloud text'));
 assert.equal((await get('notes')).length,2);
 button('View photo / play video').click();await wait('Preview open');assert(w.document.querySelector('img'));
 w.confirm=()=>false;button('Delete item from this backup').click();await new Promise(r=>setTimeout(r,20));assert.equal([...manifests.values()][0].records.length,2);
 w.confirm=()=>true;button('Delete item from this backup').click();await wait('Deleted from this backup');assert.equal([...manifests.values()][0].records.length,1);assert.equal((await get('notes')).length,2);assert.equal((await get('media')).length,1);
 button('Delete entire backup').click();await wait('Cloud backup deleted');assert.equal(manifests.size,0);assert.equal((await get('notes')).length,2);assert.equal((await get('media')).length,1);
 db.close();dom.window.close();console.log('PASS: browse text and media, cancel deletion, delete item, delete backup; local records preserved.');
})().catch(e=>{console.error(e);process.exitCode=1;});
