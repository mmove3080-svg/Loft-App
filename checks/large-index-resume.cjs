const assert=require('node:assert/strict'),{IDBFactory}=require('fake-indexeddb'),jobs=require('../snapshot-job');
(async()=>{
 const r=new IDBFactory().open('paused-snapshot',2);r.onupgradeneeded=()=>r.result.createObjectStore('kv');const db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const encoded=Array.from({length:5127},(_,i)=>({store:'media',value:['value','x'.repeat(700)+i]}));
 const saved={id:'original-snapshot-id',createdAt:'2026-09-29T00:00:00Z',total:5127,index:5127,part:27000,uploaded:27834892288,encoded,blobs:[],pending:null,last:'IMG_2051.jpeg',state:'paused',error:'Snapshot metadata exceeds the 3 MB limit.'};
 await jobs.transaction(db,s=>s.put(saved,jobs.KEY));let lose=true,commits=0,last;
 const io={encode(){throw Error('Must not reprocess completed media');},upload(){throw Error('Must not upload media');},online:()=>true,progress:s=>last=s,commit:async(id,m)=>{assert.equal(id,saved.id);assert.equal(m.records.length,5127);assert.ok(new Blob([JSON.stringify(m)]).size>3000000);commits++;if(lose){lose=false;throw Error('Lost finalization response');}}};
 await assert.rejects(jobs.run(db,io),/Lost finalization/);assert.equal((await jobs.read(db,jobs.KEY)).index,5127);
 await jobs.run(db,io);assert.equal(last.state,'complete');assert.equal(commits,2);assert.equal(await jobs.read(db,jobs.KEY),undefined);assert.equal((await jobs.read(db,'snapshot-last-v2')).last,'IMG_2051.jpeg');db.close();console.log('PASS: old 5127/5127 checkpoint finalizes without media reads/uploads; failed finalization retains checkpoint.');
})().catch(e=>{console.error(e);process.exitCode=1;});
