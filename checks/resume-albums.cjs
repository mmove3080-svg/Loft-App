const assert=require('node:assert/strict'),{IDBFactory}=require('fake-indexeddb'),crypto=require('node:crypto');
const jobs=require('../snapshot-job.js'),{create}=require('../media-store.js');
const dbOpen=()=>new Promise((resolve,reject)=>{const r=new IDBFactory().open('resume',2);r.onupgradeneeded=()=>['kv','media','albums'].forEach(n=>r.result.createObjectStore(n,{keyPath:n==='kv'?null:'id'}));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
async function encode(v,fn){if(v instanceof Blob)return ['blob',await fn(v)];if(v&&typeof v==='object'){const a=[];for(const k of Object.keys(v).sort())a.push([k,await encode(v[k],fn)]);return ['object',a];}return ['value',v];}
const hash=async b=>crypto.createHash('sha256').update(Buffer.from(await b.arrayBuffer())).digest('hex');
(async()=>{
 const db=await dbOpen(),parts=new Map(),uploads=[],encodedIds=[],records=[{store:'media',value:{id:'one',name:'one.jpg',blob:new Blob(['original'])}},{store:'media',value:{id:'two',name:'two.mov',blob:new Blob([new Uint8Array(2400000)])}}];
 let lose=true,commitLose=true,manifests=[],state;
 const io={encode:async(v,fn)=>{encodedIds.push(v.id);return encode(v,fn);},hash,online:()=>true,progress:s=>state=s,
  exists:async(id,p)=>parts.has(p.number),upload:async(id,p,b)=>{uploads.push(p.number);parts.set(p.number,await hash(b));if(p.number===1&&lose){lose=false;throw Error('Lost upload response');}},
  commit:async(id,m)=>{manifests.push(JSON.stringify(m));if(commitLose){commitLose=false;throw Error('Lost commit response');}}};
 await jobs.create(db,records,'snapshot-id');await assert.rejects(jobs.run(db,io),/Lost upload/);
 let saved=await jobs.read(db,jobs.KEY);assert.equal(saved.index,1);assert.equal(saved.pending.number,1);assert.equal(saved.last,'one.jpg');
 // New execution reads durable state, including the uncertain uploaded chunk.
 await assert.rejects(jobs.run(db,io),/Lost commit/);saved=await jobs.read(db,jobs.KEY);assert.equal(saved.index,2);
 await jobs.run(db,io);assert.deepEqual(uploads,[0,1,2,3]);assert.equal(encodedIds.filter(x=>x==='one').length,1);assert.equal(encodedIds.filter(x=>x==='two').length,2);assert.equal(manifests[0],manifests[1]);assert.equal(state.state,'complete');assert.equal(await jobs.read(db,jobs.KEY),undefined);
 const store=create(async()=>db),a=await store.createAlbum('Family'),b=await store.createAlbum('Travel');
 await new Promise((resolve,reject)=>{const t=db.transaction('media','readwrite');for(const r of records)t.objectStore('media').put(r.value);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
 await store.move(['one','two'],a.id);assert.equal((await store.scan()).filter(x=>x.albumId===a.id).length,2);
 await store.move(['one'],b.id);const reopened=create(async()=>db),list=await reopened.scan();assert.equal(list.filter(x=>x.albumId===a.id).length,1);assert.equal(list.filter(x=>x.albumId===b.id).length,1);assert.equal(await(await reopened.get('one')).blob.text(),'original');assert.equal(list.length,2);
 await assert.rejects(store.move(['one','missing'],a.id));assert.equal((await store.get('one')).albumId,b.id,'failed multi-move must roll back');await assert.rejects(store.move(['one'],'missing-album'));assert.equal((await store.albums()).length,2);
 db.close();console.log('PASS: lost upload/commit responses, durable item/chunk resume, zero repeated completed uploads, atomic album moves and reopen persistence.');
})().catch(e=>{console.error(e);process.exitCode=1;});
