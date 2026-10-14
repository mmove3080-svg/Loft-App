/* Originals stay byte-for-byte intact. Metadata scans never retain their Blobs. */
(function(global){
'use strict';
const RETENTION=30*86400000, PURGE='media-purge-v1:';
const isDeleted=r=>Number.isFinite(r.loftDeletedAt)&&r.loftDeletedAt>0;
const pause=()=>new Promise(r=>setTimeout(r,0));
function describe(r){return {id:r.id,name:r.name||'Untitled',kind:r.kind,type:r.type,size:r.size||0,createdAt:r.createdAt,addedAt:r.addedAt,lastModified:r.lastModified,hasThumb:!!r.thumb,albumId:r.albumId||null,loftDeletedAt:r.loftDeletedAt||null,expiresAt:isDeleted(r)?r.loftDeletedAt+RETENTION:null};}
function create(openDB){
 let state={running:false,total:0,processed:0,saved:0,duplicates:0,failed:[],cancelled:false},cancel=false,retryFiles=[],listeners=new Set();
 const emit=()=>listeners.forEach(f=>f(state));
 async function database(){const d=await openDB();if(!d)throw new Error('Device storage is unavailable. Your originals have not been imported.');return d;}
 async function scan(limit,includeDeleted=false){const d=await database();return new Promise((resolve,reject)=>{const out=[];const t=d.transaction('media');const s=t.objectStore('media');const rq=limit&&s.indexNames.contains('createdAt')?s.index('createdAt').openCursor(null,'prev'):s.openCursor();rq.onerror=()=>reject(rq.error);rq.onsuccess=()=>{let c=rq.result;if(!c||limit&&out.length>=limit)return resolve(out);if((includeDeleted||!isDeleted(c.value))&&(!isDeleted(c.value)||c.value.loftDeletedAt+RETENTION>Date.now()))out.push(describe(c.value));c.continue();};});}
 async function get(id){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('media').objectStore('media').get(id);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 async function write(records,remove){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction(['media','kv'],'readwrite');records.forEach(r=>remove?t.objectStore('media').delete(r):t.objectStore('media').put(r));const q=t.objectStore('kv').get('sync-local-revision');q.onsuccess=()=>t.objectStore('kv').put((q.result||0)+1,'sync-local-revision');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error||new Error('Storage transaction failed'));});}
 async function changeTrash(ids,action,onProgress){
  const d=await database(),now=Date.now();
  await new Promise((resolve,reject)=>{
   const t=d.transaction(['media','albums','kv'],'readwrite'),media=t.objectStore('media'),kv=t.objectStore('kv');let failure;
   for(const id of new Set(ids)){
    const q=media.get(id);q.onsuccess=()=>{const r=q.result;if(!r)return;
     if(action==='delete'){if(!isDeleted(r))media.put({...r,loftDeletedAt:now});}
     else if(action==='restore'){
      if(!isDeleted(r))return;
      if(r.loftDeletedAt+RETENTION<=now){failure=new Error('The recovery period has expired.');t.abort();return;}
      const restored={...r};delete restored.loftDeletedAt;
      if(restored.albumId){const a=t.objectStore('albums').get(restored.albumId);a.onsuccess=()=>{if(!a.result)restored.albumId=null;media.put(restored);};}else media.put(restored);
      kv.delete(PURGE+id);
     }else if(action==='purge'&&isDeleted(r)){media.delete(id);kv.put({id,at:now},PURGE+id);}
    };
   }
   const v=kv.get('sync-local-revision');v.onsuccess=()=>kv.put((v.result||0)+1,'sync-local-revision');
   t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(failure||t.error||new Error('Recently Deleted could not be updated.'));
  });
  announce();if(onProgress)onProgress(ids.length);
 }
 async function remove(ids,onProgress){return changeTrash(ids,'delete',onProgress);}
 async function restore(ids){return changeTrash(ids,'restore');}
 async function purge(ids){return changeTrash(ids,'purge');}
 async function expire(){const n=await expireDatabase(await database());if(n)announce();return n;}
 async function thumbnail(id,blob){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction(['media','kv'],'readwrite');const s=t.objectStore('media'),q=s.get(id);q.onsuccess=()=>{if(!q.result||q.result.thumb)return;const r=q.result;r.thumb=blob;s.put(r);const v=t.objectStore('kv').get('sync-local-revision');v.onsuccess=()=>t.objectStore('kv').put((v.result||0)+1,'sync-local-revision');};t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error);});}
 const announce=()=>{if(global.dispatchEvent)global.dispatchEvent(new Event('loft-data-changed'));if(channel)channel.postMessage('changed');};
 const channel=global.addEventListener&&global.BroadcastChannel?new BroadcastChannel('loft-media-v2'):null;
 if(channel)channel.onmessage=()=>global.dispatchEvent(new Event('loft-data-changed'));
 async function albums(){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('albums').objectStore('albums').getAll();q.onsuccess=()=>resolve(q.result.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)));q.onerror=()=>reject(q.error);});}
 async function createAlbum(name){name=String(name||'').trim();if(!name||name.length>100)throw new Error('Use an album name between 1 and 100 characters.');const d=await database(),album={id:global.crypto.randomUUID(),name,createdAt:Date.now()};await new Promise((resolve,reject)=>{const t=d.transaction(['albums','kv'],'readwrite');t.objectStore('albums').add(album);const q=t.objectStore('kv').get('sync-local-revision');q.onsuccess=()=>t.objectStore('kv').put((q.result||0)+1,'sync-local-revision');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error);});announce();return album;}
 async function move(ids,albumId){const d=await database();await new Promise((resolve,reject)=>{const t=d.transaction(['media','albums','kv'],'readwrite');let failure;
   function apply(){for(const id of ids){const q=t.objectStore('media').get(id);q.onsuccess=()=>{if(!q.result||isDeleted(q.result)){failure=new Error('An item changed. Refresh and select it again.');t.abort();return;}t.objectStore('media').put({...q.result,albumId:albumId||null});};}const q=t.objectStore('kv').get('sync-local-revision');q.onsuccess=()=>t.objectStore('kv').put((q.result||0)+1,'sync-local-revision');}
   if(albumId){const q=t.objectStore('albums').get(albumId);q.onsuccess=()=>{if(!q.result){failure=new Error('Album no longer exists.');t.abort();}else apply();};}else apply();
   t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(failure||t.error||new Error('Move could not be saved.'));});announce();}
 async function checkpoint(){const d=await database();return new Promise((resolve,reject)=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put({...state,updatedAt:Date.now()},'media-import-last');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error);});}
 async function lastJob(){const d=await database();return new Promise((resolve,reject)=>{const q=d.transaction('kv').objectStore('kv').get('media-import-last');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
 const signature=f=>JSON.stringify([f.name,f.size,f.lastModified||f.createdAt||0]);
 async function equal(a,b){if(!a||a.size!==b.size)return false;for(let i=0;i<a.size;i+=1048576){const x=new Uint8Array(await a.slice(i,i+1048576).arrayBuffer()),y=new Uint8Array(await b.slice(i,i+1048576).arrayBuffer());for(let j=0;j<x.length;j++)if(x[j]!==y[j])return false;await pause();}return true;}
 async function importFiles(files,albumId=null){
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
      const id=global.crypto.randomUUID(),record={id,kind,name:f.name,type:f.type,size:f.size,createdAt:f.lastModified||Date.now(),lastModified:f.lastModified||0,addedAt:Date.now(),blob:f,thumb:null,readable:true,albumId};
      let attempts=0;for(;;){try{await write([record]);break;}catch(e){if(e.name==='QuotaExceededError'||++attempts>1)throw e;await pause();}}
      if(!known.has(key))known.set(key,[]);known.get(key).push(id);state.saved++;
     }
    }catch(e){state.failed.push({name:f.name,size:f.size,message:e.name==='QuotaExceededError'?'Device storage is full. Free space, then retry.':e.message||'Could not save file'});retryFiles.push(f);if(e.name==='QuotaExceededError'){state.cancelled=true;cancel=true;}}
    state.processed++;if(i%20===0||state.processed===state.total){await checkpoint();emit();}await pause();
   }
  }catch(e){state.error=e.message;}finally{state.running=false;try{await checkpoint();}catch(e){state.error=state.error||e.message;}emit();}
  return state;
 }
 return {scan,get,remove,restore,purge,expire,thumbnail,importFiles,lastJob,albums,createAlbum,move,get state(){return state;},cancel(){cancel=true;},retry(){const f=retryFiles.slice();return importFiles(f);},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
async function expireDatabase(d,now=Date.now()){
 if(!d)return 0;
 return new Promise((resolve,reject)=>{let count=0;const t=d.transaction(['media','kv'],'readwrite'),kv=t.objectStore('kv'),q=t.objectStore('media').openCursor();
 q.onsuccess=()=>{const c=q.result;if(c){const r=c.value;if(isDeleted(r)&&r.loftDeletedAt+RETENTION<=now){c.delete();kv.put({id:r.id,at:now},PURGE+r.id);count++;}c.continue();}else if(count){const v=kv.get('sync-local-revision');v.onsuccess=()=>kv.put((v.result||0)+1,'sync-local-revision');}};
 t.oncomplete=()=>resolve(count);t.onerror=t.onabort=()=>reject(t.error);
 });
}
global.LoftMedia={create,describe,expire:expireDatabase};
if(typeof module!=='undefined')module.exports={create,describe,expire:expireDatabase};
})(typeof window!=='undefined'?window:globalThis);
