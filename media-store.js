/* Originals stay byte-for-byte intact. Metadata scans never retain their Blobs. */
(function(global){
'use strict';
const pause=()=>new Promise(r=>setTimeout(r,0));
function describe(r){return {id:r.id,name:r.name||'Untitled',kind:r.kind,type:r.type,size:r.size||0,createdAt:r.createdAt,addedAt:r.addedAt,lastModified:r.lastModified,hasThumb:!!r.thumb};}
function create(openDB){
 let state={running:false,total:0,processed:0,saved:0,duplicates:0,failed:[],cancelled:false},cancel=false,retryFiles=[],listeners=new Set();
 const emit=()=>listeners.forEach(f=>f(state));
 async function database(){const d=await openDB();if(!d)throw new Error('Device storage is unavailable. Your originals have not been imported.');return d;}
 async function scan(limit){const d=await database();return new Promise((resolve,reject)=>{const out=[];const t=d.transaction('media');const s=t.objectStore('media');const rq=limit&&s.indexNames.contains('createdAt')?s.index('createdAt').openCursor(null,'prev'):s.openCursor();rq.onerror=()=>reject(rq.error);rq.onsuccess=()=>{let c=rq.result;if(!c||limit&&out.length>=limit)return resolve(out);out.push(describe(c.value));c.continue();};});}
 async function get(id){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('media').objectStore('media').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 async function write(records,remove){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction(['media','kv'],'readwrite');records.forEach(r=>remove?t.objectStore('media').delete(r):t.objectStore('media').put(r));const q=t.objectStore('kv').get('sync-local-revision');q.onsuccess=()=>t.objectStore('kv').put((q.result||0)+1,'sync-local-revision');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error||new Error('Storage transaction failed'));});}
 async function remove(ids,onProgress){for(let n=0;n<ids.length;n+=100){await write(ids.slice(n,n+100),true);if(onProgress)onProgress(Math.min(n+100,ids.length));await pause();}}
 async function thumbnail(id,blob){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction(['media','kv'],'readwrite');const s=t.objectStore('media'),q=s.get(id);q.onsuccess=()=>{if(!q.result||q.result.thumb)return;const r=q.result;r.thumb=blob;s.put(r);const v=t.objectStore('kv').get('sync-local-revision');v.onsuccess=()=>t.objectStore('kv').put((v.result||0)+1,'sync-local-revision');};t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error);});}
 async function checkpoint(){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put({...state,updatedAt:Date.now()},'media-import-last');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error);});}
 async function lastJob(){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('kv').objectStore('kv').get('media-import-last');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 const signature=f=>JSON.stringify([f.name,f.size,f.lastModified||f.createdAt||0]);
 async function equal(a,b){if(!a||a.size!==b.size)return false;for(let i=0;i<a.size;i+=1048576){const x=new Uint8Array(await a.slice(i,i+1048576).arrayBuffer()),y=new Uint8Array(await b.slice(i,i+1048576).arrayBuffer());for(let j=0;j<x.length;j++)if(x[j]!==y[j])return false;await pause();}return true;}
 async function importFiles(files){
  if(state.running)throw new Error('An import is already running.');
  cancel=false;retryFiles=[];state={running:true,total:files.length,processed:0,saved:0,duplicates:0,failed:[],cancelled:false};emit();
  try{
   const metadata=await scan(),known=new Map();metadata.forEach(m=>{const k=signature(m);if(!known.has(k))known.set(k,[]);known.get(k).push(m.id);});
   await checkpoint();
   for(let i=0;i<files.length;i++){
    if(cancel){state.cancelled=true;break;}
    const f=files[i];
    try{
     const kind=/^video\//.test(f.type)||/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name)?'video':/^image\//.test(f.type)||/\.(jpe?g|png|gif|webp|heic|heif|avif|tiff?|bmp)$/i.test(f.name)?'image':null;
     if(!kind)throw new Error('Unsupported file type. Choose photos or videos.');
     const key=signature(f);let duplicate=false;
     for(const id of known.get(key)||[]){const previous=await get(id);if(previous&&await equal(previous.blob,f)){duplicate=true;break;}}
     if(duplicate)state.duplicates++;
     else{
      const id=global.crypto.randomUUID(),record={id,kind,name:f.name,type:f.type,size:f.size,createdAt:f.lastModified||Date.now(),lastModified:f.lastModified||0,addedAt:Date.now(),blob:f,thumb:null,readable:true};
      let attempts=0;for(;;){try{await write([record]);break;}catch(e){if(e.name==='QuotaExceededError'||++attempts>1)throw e;await pause();}}
      if(!known.has(key))known.set(key,[]);known.get(key).push(id);state.saved++;
     }
    }catch(e){state.failed.push({name:f.name,size:f.size,message:e.name==='QuotaExceededError'?'Device storage is full. Free space, then retry.':e.message||'Could not save file'});retryFiles.push(f);if(e.name==='QuotaExceededError'){state.cancelled=true;cancel=true;}}
    state.processed++;if(i%20===0||state.processed===state.total){await checkpoint();emit();}await pause();
   }
  }catch(e){state.error=e.message;}finally{state.running=false;try{await checkpoint();}catch(e){state.error=state.error||e.message;}emit();}
  return state;
 }
 return {scan,get,remove,thumbnail,importFiles,lastJob,get state(){return state;},cancel(){cancel=true;},retry(){const f=retryFiles.slice();return importFiles(f);},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
global.LoftMedia={create,describe};
if(typeof module!=='undefined')module.exports={create,describe};
})(typeof window!=='undefined'?window:globalThis);
