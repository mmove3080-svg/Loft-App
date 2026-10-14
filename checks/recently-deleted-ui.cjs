const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),fs=require('fs'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));const until=async f=>{for(let i=0;i<200;i++){if(await f())return;await delay(10);}throw Error('Timed out');};
(async()=>{
 const db=await new Promise(resolve=>{const q=new IDBFactory().open('trash-ui',2);q.onupgradeneeded=()=>['media','albums','kv'].forEach(n=>q.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));q.onsuccess=()=>resolve(q.result);});
 await new Promise(resolve=>{const t=db.transaction(['media','albums'],'readwrite');t.objectStore('albums').put({id:'family',name:'Family'});for(let i=0;i<2;i++)t.objectStore('media').put({id:'m'+i,name:'photo'+i+'.jpg',kind:'image',albumId:'family',blob:new Blob(['original'+i]),thumb:new Blob(['preview'])});t.oncomplete=resolve;});
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.Blob=Blob;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};let confirm=true,confirmations=[];w.confirm=s=>{confirmations.push(s);return confirm;};
 for(const n of ['media-store.js','photos-ui.js'])w.eval(fs.readFileSync(n,'utf8'));const store=w.LoftMedia.create(async()=>db);let cleanup;
 const root=w.document.querySelector('main'),button=name=>[...root.querySelectorAll('button')].find(b=>b.textContent===name),album=value=>{const s=root.querySelector('[aria-label=Album]');s.value=value;s.dispatchEvent(new w.Event('change'));};
 const mount=()=>{root.textContent='';cleanup=w.LoftPhotos.mount({root,win:root,toast:()=>{}},store);};
 try{
  mount();await until(()=>root.querySelectorAll('.media-tile').length===2);button('Select').click();root.querySelector('.media-tile').click();
  confirm=false;button('Delete').click();await delay(20);assert.equal((await store.scan()).length,2);
  confirm=true;button('Delete').click();await until(()=>root.querySelectorAll('.media-tile').length===1);assert.equal((await store.scan()).length,1);
  album('recently-deleted');await until(()=>root.querySelector('.recovery-countdown'));assert.equal(root.querySelector('h1').textContent,'Recently Deleted');assert.match(root.querySelector('.recovery-countdown').textContent,/30 days left/);
  assert(button('Move to Album').hidden);assert(button('Export').hidden);assert(!button('Restore All').disabled);assert(root.querySelector('.photo-add').hidden);
  root.querySelector('.media-tile').click();button('Restore').click();await until(()=>!root.querySelector('.media-tile'));assert.equal((await store.scan()).length,2);assert.equal((await store.get('m0')).albumId,'family');
  await store.remove(['m0','m1']);await until(()=>root.querySelectorAll('.media-tile').length===2);
  cleanup();mount();await until(()=>root.querySelector('[aria-label=Album] option[value=recently-deleted]'));album('recently-deleted');await until(()=>root.querySelectorAll('.media-tile').length===2);
  button('Restore All').click();await until(()=>!root.querySelector('.media-tile'));assert.equal((await store.scan()).length,2);
  await store.remove(['m0','m1']);await until(()=>root.querySelectorAll('.media-tile').length===2);
  confirm=false;button('Delete All Permanently').click();await delay(30);assert.equal((await store.scan(undefined,true)).length,2);
  confirm=true;button('Delete All Permanently').click();await until(async()=>!(await store.scan(undefined,true)).length);await until(()=>!root.querySelector('.media-tile'));
  assert(confirmations.some(t=>t.includes('cannot be undone')));assert.equal(await store.get('m0'),undefined);
  console.log('PASS: actual gallery UI deletion/cancel, Recently Deleted picker, day countdown, selected restore, Restore All, permanent-delete confirmation/cancel, Delete All, original album and remount persistence.');
 }finally{cleanup?.();w.close();db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
