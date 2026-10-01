const assert=require('node:assert/strict'),{IDBFactory}=require('fake-indexeddb');
const jobs=require('../snapshot-job'),{sharedMedia}=require('../lib/shared-media'),{fixture}=require('./shared-fixture.cjs');
const dbOpen=()=>new Promise(resolve=>{const q=new IDBFactory().open('incremental',2);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>resolve(q.result);});
async function encode(v,fn){if(v instanceof Blob)return ['blob',await fn(v)];if(v&&typeof v==='object'){const entries=[];for(const k of Object.keys(v).sort())entries.push([k,await encode(v[k],fn)]);return ['object',entries];}return ['value',v];}
(async()=>{
 const db=await dbOpen(),f=fixture(),prefix='owner/',old='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';let uploaded=0,lose=false,committed;
 const catalog=new Map(),records=[];
 // 5,127 originals already backed up; each unique and independently verified.
 for(let i=0;i<5217;i++){
  const bytes=Buffer.from('photo-original-'+i),hash=f.hash(bytes);
  records.push({store:'media',value:{id:'m'+i,name:'IMG_'+i+'.jpeg',blob:new Blob([bytes],{type:'image/jpeg'})}});
  if(i<5127){f.seed(prefix+'parts/'+old+'/'+i,bytes,{sha256:hash});catalog.set(hash,{id:old,part:i,size:bytes.length});}
 }
 const call=(action,body,query={})=>sharedMedia({s3:f.s3,Bucket:'b',prefix,action,body,query,method:body?'POST':'GET'});
 const io={encode,hash:async b=>f.hash(Buffer.from(await b.arrayBuffer())),online:()=>true,progress:()=>{},
  exists:async(id,p)=>(await call('shared-status',undefined,{hash:p.hash})).exists,
  reuse:async p=>{if((await call('shared-status',undefined,{hash:p.hash})).exists)return true;const source=catalog.get(p.hash);return source?(await call('shared-promote',{hash:p.hash,...source})).saved:false;},
  upload:async(id,p,b)=>{await call('shared-put',{hash:p.hash,data:Buffer.from(await b.arrayBuffer()).toString('base64')});uploaded++;if(lose){lose=false;throw Error('Lost response');}},
  commit:async(id,m)=>{committed=m;}
 };
 await jobs.create(db,records,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
 await jobs.run(db,io);assert.equal(uploaded,90);assert.equal(f.copies.length,5127);assert.equal(committed.records.length,5217);
 // Remove old physical copies: every new manifest media reference remains readable.
 for(let i=0;i<5127;i++)f.objects.delete(prefix+'parts/'+old+'/'+i);
 for(let i=0;i<5217;i++){const bytes=Buffer.from('photo-original-'+i);assert.deepEqual(await call('shared-get',undefined,{hash:f.hash(bytes)}),bytes);}
 // A repeated small subset uploads nothing; changed content uploads once and lost responses recover.
 const subset=records.slice(0,3);await jobs.create(db,subset,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');await jobs.run(db,io);assert.equal(uploaded,90);
 subset[0]={store:'media',value:{id:'m0',name:'same-name.jpeg',blob:new Blob(['changed bytes'])}};
 await jobs.create(db,subset,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');lose=true;await assert.rejects(jobs.run(db,io),/Lost response/);
 await jobs.run(db,io);assert.equal(uploaded,91);assert.equal(committed.records.length,3);
 assert.equal(await jobs.read(db,jobs.KEY),undefined);
 // Upgrade an actual old-format partially completed job without repeating row 0.
 const oldValue=await encode(records[0].value,async b=>({type:b.type,size:b.size,parts:[{number:0,hash:await io.hash(b)}]}));
 const legacy={id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',createdAt:'2026-09-30',total:2,index:1,part:1,uploaded:16,encoded:[{store:'media',value:oldValue}],blobs:[],pending:null,last:'IMG_0.jpeg',state:'paused'};
 await jobs.transaction(db,s=>{s.put(legacy,jobs.KEY);s.put(records[1],'snapshot-row-v2:1');});
 const originalTransaction=db.transaction.bind(db);let failMigration=true;
 db.transaction=(...args)=>{const t=originalTransaction(...args),originalStore=t.objectStore.bind(t);t.objectStore=name=>{const store=originalStore(name),put=store.put.bind(store);store.put=(value,key)=>{if(failMigration&&String(key).startsWith('snapshot-encoded-v3:')){failMigration=false;throw Error('Quota exhausted');}return put(value,key);};return store;};return t;};
 await assert.rejects(jobs.run(db,io),/Quota exhausted/);
 db.transaction=originalTransaction;
 const preserved=await jobs.read(db,jobs.KEY);assert.equal(preserved.encoded.length,1);assert.equal(preserved.index,1);assert(!preserved.encodedRows);
 await jobs.run(db,io);assert.equal(uploaded,91);assert.equal(committed.records.length,2);
 assert(!committed.records[0].value[1].find(x=>x[0]==='blob')[1][1].parts[0].shared,'previously saved legacy reference retained');
 assert(committed.records[1].value[1].find(x=>x[0]==='blob')[1][1].parts[0].shared);
 db.close();
 console.log('PASS: 5,127 existing photos + 90 new photos = exactly 90 media uploads; all 5,217 originals readable after legacy parts removed; unchanged media skips upload; changed bytes and lost-response recovery upload once.');
})().catch(e=>{console.error(e);process.exitCode=1;});
