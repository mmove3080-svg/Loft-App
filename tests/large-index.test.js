const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {transfer,CHUNK}=require('../lib/manifest-transfer');
const client=require('../snapshot-transfer');
const hash=async b=>crypto.createHash('sha256').update(Buffer.from(await b.arrayBuffer())).digest('hex');
function fixture(){
 const objects=new Map(),writes=[],prefix='loft-private/v1/owner/',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const s3={send:async c=>{
  const x=c.input,o=objects.get(x.Key);
  if(c.constructor.name==='PutObjectCommand'){
   if(x.IfNoneMatch==='*'&&o)throw {$metadata:{httpStatusCode:412}};
   const bytes=Buffer.from(x.Body);objects.set(x.Key,{bytes,etag:'"'+crypto.createHash('sha256').update(bytes).digest('hex')+'"'});writes.push(x.Key);return {};
  }
  if(!o)throw {$metadata:{httpStatusCode:404}};
  if(x.IfMatch&&x.IfMatch!==o.etag)throw {$metadata:{httpStatusCode:412}};
  if(c.constructor.name==='HeadObjectCommand')return {ContentLength:o.bytes.length,ETag:o.etag};
  if(c.constructor.name==='GetObjectCommand'){
   let bytes=o.bytes;if(x.Range){const [,a,b]=/bytes=(\d+)-(\d+)/.exec(x.Range);bytes=bytes.subarray(+a,+b+1);}
   return {Body:{transformToByteArray:async()=>bytes},ETag:o.etag};
  }throw Error(c.constructor.name);
 }};
 const request=async(action,query,body)=>{assert.ok(!body||Buffer.byteLength(JSON.stringify(body))<1500000,'bounded HTTP request');const r=await transfer({s3,Bucket:'b',prefix,id,action,method:body===undefined?'GET':'POST',query,body});assert.ok(Buffer.byteLength(JSON.stringify(r))<1500000,'bounded HTTP response');return {json:async()=>r};};
 return {objects,writes,prefix,id,s3,request};
}
const large=()=>({version:1,createdAt:'2026-09-29T00:00:00Z',parts:27000,records:Array.from({length:5127},(_,i)=>({store:'media',value:['object',[['name',['value',`IMG_${i}_😀.jpeg`]],['description',['value','x'.repeat(1100)]]]]}))});
test('5127-record index over 3 MB commits and reads in bounded chunks; lost responses retry without media writes',async()=>{
 const f=fixture(),m=large();assert.ok(Buffer.byteLength(JSON.stringify(m))>3000000);
 let lose=true;const request=async(a,q,b)=>{const r=await f.request(a,q,b);if(a==='index-finalize'&&lose){lose=false;throw Error('Lost response');}return r;};
 await assert.rejects(client.commit(f.id,m,{request,hash}),/Lost response/);
 const n=f.writes.length;await client.commit(f.id,m,{request,hash});assert.equal(f.writes.length,n,'retry must not overwrite existing chunks or commit');
 assert.deepEqual((await client.read(f.id,f.request)).manifest,m);
 assert.ok(f.writes.every(k=>k.includes('/metadata/')||k.includes('/commits/')),'no original media uploaded');
});
test('corrupt, incomplete, invalid, and conflicting indexes cannot publish; reads reject changed revisions',async()=>{
 const f=fixture(),m=large(),blob=new Blob([JSON.stringify(m)]),h=await hash(blob);
 await assert.rejects(f.request('index-finalize',{}, {hash:h,size:blob.size}));
 await assert.rejects(f.request('index-chunk',{}, {hash:'../other',page:0,data:'YQ=='}),/checksum/);
 await client.commit(f.id,m,{request:f.request,hash});
 const key=f.prefix+'commits/'+f.id+'.json',saved=f.objects.get(key);
 await assert.rejects(client.read(f.id,async(a,q,b)=>{if(a==='index-page')f.objects.get(key).etag='changed';return f.request(a,q,b);}));
 f.objects.set(key,saved);await assert.rejects(client.commit(f.id,{...m,parts:27001},{request:f.request,hash}),/differs/);
 const first=f.prefix+'parts/'+f.id+'/metadata/'+h+'/0';f.objects.get(first).bytes[0]^=1;
 await assert.rejects(f.request('index-finalize',{}, {hash:h,size:blob.size}),/integrity/);
 await assert.rejects(f.request('index-finalize',{}, {hash:h,size:65*CHUNK}),/size/);
});
test('legacy v1 committed snapshots can be read through paged transport',async()=>{
 const f=fixture(),m={version:1,parts:0,records:[]};f.objects.set(f.prefix+'commits/'+f.id+'.json',{bytes:Buffer.from(JSON.stringify(m)),etag:'"legacy"'});
 assert.deepEqual(await client.read(f.id,f.request),{manifest:m,revision:'"legacy"'});
});
