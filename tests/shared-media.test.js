const test=require('node:test'),assert=require('node:assert/strict');
const {sharedMedia}=require('../lib/shared-media'),{manage,refs}=require('../lib/snapshots');
const {fixture}=require('../checks/shared-fixture.cjs');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',next='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',prefix='owner/';
function setup(){const f=fixture();f.call=(action,body,query={})=>sharedMedia({s3:f.s3,Bucket:'b',prefix,action,body,query,method:body===undefined?'GET':'POST'});return f;}
test('shared media is checksum-verified, owner-scoped and idempotent',async()=>{
 const f=setup(),bytes=Buffer.from('original photo'),hash=f.hash(bytes);
 await assert.rejects(f.call('shared-put',{hash:'../escape',data:bytes.toString('base64')}));
 await assert.rejects(f.call('shared-put',{hash:'a'.repeat(64),data:bytes.toString('base64')}));
 const body={hash,data:bytes.toString('base64')};await Promise.all([f.call('shared-put',body),f.call('shared-put',body)]);
 assert.equal(f.writes.length,1);assert.deepEqual(await f.call('shared-get',undefined,{hash}),bytes);
 assert.equal((await f.call('shared-status',undefined,{hash})).size,bytes.length);
 f.objects.get(prefix+'shared-media/'+hash).bytes[0]^=1;await assert.rejects(f.call('shared-get',undefined,{hash}),/integrity/);
});
test('legacy media promotion checks server hash and source revision without downloading media',async()=>{
 const f=setup(),bytes=Buffer.from('legacy'),hash=f.hash(bytes),source=prefix+'parts/'+id+'/0';
 assert.deepEqual(await f.call('shared-promote',{hash,id,part:0,size:bytes.length}),{saved:false});
 f.seed(source,bytes,{sha256:'f'.repeat(64)});assert.equal((await f.call('shared-promote',{hash,id,part:0,size:bytes.length})).saved,false);
 f.seed(source,bytes,{sha256:hash});assert.equal((await f.call('shared-promote',{hash,id,part:0,size:bytes.length})).saved,true);
 await f.call('shared-promote',{hash,id,part:0,size:bytes.length});assert.equal(f.copies.length,1);
 assert.deepEqual(await f.call('shared-get',undefined,{hash}),bytes);
 await assert.rejects(f.call('shared-promote',{hash:'b'.repeat(64),id:'../other',part:0,size:1}));
});
test('deleting a legacy or shared snapshot and cleaning unused parts cannot erase shared originals',async()=>{
 const f=setup(),bytes=Buffer.from('shared photo'),hash=f.hash(bytes);
 f.seed(prefix+'parts/'+id+'/0',bytes,{sha256:hash});await f.call('shared-promote',{hash,id,part:0,size:bytes.length});
 const media=shared=>({store:'media',value:['blob',{type:'image/jpeg',size:bytes.length,parts:[{number:0,hash,...(shared?{shared:true}:{})}]}]});
 for(const [snapshot,shared] of [[id,false],[next,true]])f.seed(prefix+'commits/'+snapshot+'.json',JSON.stringify({version:1,parts:1,records:[media(shared)]}));
 for(const snapshot of [id,next]){
  const args={s3:f.s3,Bucket:'b',prefix,id:snapshot};
  await manage({...args,action:'cleanup'});
  const revision=f.objects.get(prefix+'commits/'+snapshot+'.json').etag;
  let result=await manage({...args,action:'delete-snapshot',body:{revision}});
  while(!result.done)result=await manage({...args,action:'delete-snapshot'});
  assert.deepEqual(await f.call('shared-get',undefined,{hash}),bytes);
 }
 assert.equal(refs(media(true).value).size,0);
 await assert.rejects(async()=>refs(['blob',{parts:[{number:0,shared:true,hash:'../x'}]}]));
});
