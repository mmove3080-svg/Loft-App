'use strict';
// Chunk only the transport. Committed snapshots retain the existing v1 JSON format.
const {GetObjectCommand,PutObjectCommand,HeadObjectCommand}=require('@aws-sdk/client-s3');
const {createHash}=require('node:crypto');
const {HttpError}=require('./security');
const CHUNK=1048576, MAX=64*CHUNK;
const digest=b=>createHash('sha256').update(b).digest('hex');
function validHash(h){if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))throw new HttpError(400,'Invalid index checksum.');return h;}
function integer(n,min,max){if(!Number.isSafeInteger(n)||n<min||n>max)throw new HttpError(400,'Invalid index size or page.');return n;}
async function immutable(s3,input){
 try{await s3.send(new PutObjectCommand({...input,IfNoneMatch:'*'}));}
 catch(e){if(e.$metadata?.httpStatusCode!==412)throw e;const r=await s3.send(new GetObjectCommand({Bucket:input.Bucket,Key:input.Key}));if(!Buffer.from(await r.Body.transformToByteArray()).equals(input.Body))throw new HttpError(409,'Saved index differs. Progress preserved.');}
}
async function transfer({s3,Bucket,prefix,id,action,method,query,body}){
 const key=prefix+'commits/'+id+'.json';
 if(action==='index-info'||action==='index-page'){
  if(method!=='GET')throw new HttpError(405,'Method not allowed.');
  if(action==='index-info'){
   const h=await s3.send(new HeadObjectCommand({Bucket,Key:key}));
   integer(h.ContentLength,1,MAX);if(!h.ETag)throw new HttpError(503,'Could not verify snapshot revision.');
   return {size:h.ContentLength,revision:h.ETag,chunkSize:CHUNK};
  }
  const page=integer(Number(query.page),0,63),revision=query.revision;
  if(typeof revision!=='string'||!revision.length||revision.length>200)throw new HttpError(400,'Invalid revision.');
  const r=await s3.send(new GetObjectCommand({Bucket,Key:key,IfMatch:revision,Range:`bytes=${page*CHUNK}-${(page+1)*CHUNK-1}`}));
  const bytes=Buffer.from(await r.Body.transformToByteArray());
  if(bytes.length>CHUNK||r.ETag!==revision)throw new HttpError(409,'Snapshot changed. Open it again.');
  return {data:bytes.toString('base64')};
 }
 if(method!=='POST')throw new HttpError(405,'Method not allowed.');
 if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON.');}}
 if(!body)throw new HttpError(400,'Missing index data.');
 const hash=validHash(body.hash),base=prefix+'parts/'+id+'/metadata/'+hash+'/';
 if(action==='index-chunk'){
  const page=integer(body.page,0,63);
  if(typeof body.data!=='string'||body.data.length>1398104||!body.data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw new HttpError(400,'Invalid index chunk.');
  const bytes=Buffer.from(body.data,'base64');integer(bytes.length,1,CHUNK);
  await immutable(s3,{Bucket,Key:base+page,Body:bytes,ContentType:'application/octet-stream',CacheControl:'private, no-store'});
  return {saved:true};
 }
 if(action!=='index-finalize')throw new HttpError(400,'Unknown index operation.');
 const size=integer(body.size,1,MAX),pages=Math.ceil(size/CHUNK),pieces=[];
 for(let i=0;i<pages;i++){
  const r=await s3.send(new GetObjectCommand({Bucket,Key:base+i}));
  const b=Buffer.from(await r.Body.transformToByteArray());
  if(b.length!==Math.min(CHUNK,size-i*CHUNK))throw new HttpError(400,'Incomplete snapshot index. Resume to retry.');pieces.push(b);
 }
 const bytes=Buffer.concat(pieces);
 if(digest(bytes)!==hash)throw new HttpError(400,'Snapshot index integrity check failed.');
 let manifest;try{manifest=JSON.parse(bytes.toString('utf8'));}catch{throw new HttpError(400,'Invalid snapshot JSON.');}
 if(manifest.version!==1||!Array.isArray(manifest.records)||!Number.isInteger(manifest.parts)||manifest.parts<0||manifest.parts>1000000||manifest.deleting)throw new HttpError(400,'Invalid snapshot.');
 await immutable(s3,{Bucket,Key:key,Body:bytes,ContentType:'application/json',CacheControl:'private, no-store'});
 // Staged metadata remains available for retry after a lost commit response.
 // Existing snapshot cleanup/deletion removes it with other unreferenced parts.
 return {saved:true};
}
module.exports={transfer,CHUNK,MAX};
