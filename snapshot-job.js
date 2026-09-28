/* Durable upload queue. A committed item is never encoded or uploaded again. */
(function(global){
'use strict';
const KEY='snapshot-job-v2', ROW='snapshot-row-v2:';
function read(db,key){return new Promise((resolve,reject)=>{const q=db.transaction('kv').objectStore('kv').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function transaction(db,fn){return new Promise((resolve,reject)=>{const t=db.transaction('kv','readwrite');fn(t.objectStore('kv'));t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error||new Error('Snapshot checkpoint could not be saved.'));});}
async function create(db,records,id){
 const job={id,createdAt:new Date().toISOString(),total:records.length,index:0,part:0,uploaded:0,encoded:[],blobs:[],pending:null,last:'None yet',state:'saving'};
 await transaction(db,s=>{records.forEach((r,i)=>s.put(r,ROW+i));s.put(job,KEY);});return job;
}
async function run(db,io){
 let job=await read(db,KEY);if(!job)return;
 const checkpoint=()=>transaction(db,s=>s.put(job,KEY));
 const notify=()=>io.progress({...job,encoded:undefined,blobs:undefined});
 try{
  job.state='saving';job.error=null;await checkpoint();notify();
  for(;job.index<job.total;){
   const r=await read(db,ROW+job.index);if(!r)throw new Error('Snapshot source is missing. Saved progress has been preserved.');
   let ordinal=0;
   const value=await io.encode(r.value,async blob=>{
    const n=ordinal++;const info=job.blobs[n]||(job.blobs[n]={type:blob.type,size:blob.size,parts:[]});
    for(let offset=info.parts.length*1048576;offset<blob.size;offset+=1048576){
     if(!io.online())throw new Error('Offline. Resuming automatically when connected.');
     const slice=blob.slice(offset,offset+1048576);
     if(job.part>=1000000)throw new Error('Snapshot has too many upload parts.');
     // Persist intent before sending. After a lost response, HEAD verifies the
     // existing object without downloading or uploading its bytes again.
     const uncertain=!!job.pending;
     const p=job.pending||{number:job.part,hash:await io.hash(slice),size:slice.size};
     if(!job.pending){job.pending=p;await checkpoint();}
     let exists=false;
     if(uncertain)exists=await io.exists(job.id,p);
     if(!exists)await io.upload(job.id,p,slice);
     info.parts.push({number:p.number,hash:p.hash});job.part++;job.uploaded+=p.size;job.pending=null;
     await checkpoint();notify();
    }
    return info;
   });
   job.encoded.push({store:r.store,value});job.index++;job.last=r.value.name||r.value.title||r.value.id;job.blobs=[];
   // The completion marker and removal of staged source share one transaction.
   await transaction(db,s=>{s.put(job,KEY);s.delete(ROW+(job.index-1));});notify();
  }
  const manifest={version:1,createdAt:job.createdAt,parts:job.part,records:job.encoded};
  if(new Blob([JSON.stringify(manifest)]).size>3000000)throw new Error('Snapshot metadata exceeds the 3 MB limit.');
  await io.commit(job.id,manifest);
  job.state='complete';await transaction(db,s=>{s.put({...job,encoded:[],blobs:[]},'snapshot-last-v2');s.delete(KEY);s.delete('snapshot-session-v2');});notify();return job;
 }catch(e){job.state='paused';job.error=e.message;try{await checkpoint();}catch{}notify();throw e;}
}
global.LoftSnapshotJob={create,run,read,transaction,KEY};
if(typeof module!=='undefined')module.exports=global.LoftSnapshotJob;
})(typeof window!=='undefined'?window:globalThis);
