/* Durable upload queue. A committed item is never encoded or uploaded again. */
(function(global){
'use strict';
const KEY='snapshot-job-v2', ROW='snapshot-row-v2:', ENCODED='snapshot-encoded-v3:';
function read(db,key){return new Promise((resolve,reject)=>{const q=db.transaction('kv').objectStore('kv').get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
function transaction(db,fn){return new Promise((resolve,reject)=>{const t=db.transaction('kv','readwrite');t.oncomplete=resolve;t.onerror=t.onabort=()=>reject(t.error||new Error('Snapshot checkpoint could not be saved.'));try{fn(t.objectStore('kv'));}catch(e){t.abort();reject(e);}});}
async function create(db,records,id){
 const job={id,createdAt:new Date().toISOString(),total:records.length,index:0,part:0,uploaded:0,encodedRows:true,encoded:[],blobs:[],pending:null,last:'None yet',state:'saving'};
 await transaction(db,s=>{records.forEach((r,i)=>s.put(r,ROW+i));s.put(job,KEY);});return job;
}
async function run(db,io){
 let job=await read(db,KEY);if(!job)return;
 const check=()=>{if(io.check)io.check();};
 const checkpoint=()=>transaction(db,s=>s.put(job,KEY));
 const notify=()=>io.progress({...job,encoded:undefined,blobs:undefined});
 try{
  if(!job.encodedRows){
   const old=job.encoded||[];
   if(old.length!==job.index)throw new Error('Snapshot checkpoint is incomplete. Existing data was preserved.');
   const upgraded={...job,encodedRows:true,encoded:[]};
   await transaction(db,s=>{old.forEach((value,i)=>s.put(value,ENCODED+i));s.put(upgraded,KEY);});job=upgraded;
  }
  check();job.state='saving';job.error=null;await checkpoint();notify();
  for(;job.index<job.total;){
   check();
   const r=await read(db,ROW+job.index);if(!r)throw new Error('Snapshot source is missing. Saved progress has been preserved.');
   let ordinal=0;
   const value=await io.encode(r.value,async blob=>{
    const n=ordinal++;const info=job.blobs[n]||(job.blobs[n]={type:blob.type,size:blob.size,parts:[]});
    for(let offset=info.parts.length*1048576;offset<blob.size;offset+=1048576){
     check();if(!io.online())throw new Error('Offline. Resuming automatically when connected.');
     const slice=blob.slice(offset,offset+1048576);
     if(job.part>=1000000)throw new Error('Snapshot has too many upload parts.');
     // Persist intent before sending. After a lost response, HEAD verifies the
     // existing object without downloading or uploading its bytes again.
     const uncertain=!!job.pending;
     const p=job.pending||{number:job.part,hash:await io.hash(slice),size:slice.size};
     if(!job.pending){job.pending=p;await checkpoint();}
     let exists=false;
     if(uncertain)exists=await io.exists(job.id,p);
     if(!exists&&io.reuse){
      // Old pending parts remain recoverable. Only unfinished work changes storage.
      p.shared=true;await checkpoint();exists=await io.reuse(p);
     }
     check();if(!exists){await io.upload(job.id,p,slice);job.transferred=(job.transferred||0)+p.size;}
     else job.reused=(job.reused||0)+p.size;
     info.parts.push({number:p.number,hash:p.hash,...(p.shared?{shared:true}:{})});job.part++;job.uploaded+=p.size;job.pending=null;
     await checkpoint();notify();
    }
    return info;
   });
   const priorLast=job.last,priorBlobs=job.blobs;
   const completed={store:r.store,value};job.index++;job.last=r.value.name||r.value.title||r.value.id;job.blobs=[];
   // The completion marker and removal of staged source share one transaction.
   try{await transaction(db,s=>{s.put(job,KEY);s.put(completed,ENCODED+(job.index-1));s.delete(ROW+(job.index-1));});}
   catch(e){job.index--;job.last=priorLast;job.blobs=priorBlobs;throw e;}notify();
  }
  const records=[];for(let i=0;i<job.index;i++){const record=await read(db,ENCODED+i);if(!record)throw new Error('Completed snapshot metadata is missing. Existing media was preserved.');records.push(record);}
  const manifest={version:1,createdAt:job.createdAt,parts:job.part,records};
  job.state='finalizing';await checkpoint();notify();
  check();await io.commit(job.id,manifest);
  job.state='complete';await transaction(db,s=>{s.put({...job,encoded:[],blobs:[]},'snapshot-last-v2');s.delete(KEY);s.delete('snapshot-session-v2');for(let i=0;i<job.total;i++)s.delete(ENCODED+i);});notify();return job;
 }catch(e){job.state='paused';job.error=e.message;try{await checkpoint();}catch{}notify();throw e;}
}
global.LoftSnapshotJob={create,run,read,transaction,KEY};
if(typeof module!=='undefined')module.exports=global.LoftSnapshotJob;
})(typeof window!=='undefined'?window:globalThis);
