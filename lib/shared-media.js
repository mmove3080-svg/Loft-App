'use strict';
const {HeadObjectCommand,GetObjectCommand,PutObjectCommand,CopyObjectCommand}=require('@aws-sdk/client-s3');
const {createHash}=require('node:crypto');
const {HttpError,snapshotId,partId}=require('./security');
const digest=b=>createHash('sha256').update(b).digest('hex');
function validHash(h){if(typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))throw new HttpError(400,'Invalid media checksum.');return h;}
const missing=e=>e.name==='NoSuchKey'||e.$metadata?.httpStatusCode===404;
async function sharedMedia({s3,Bucket,prefix,action,method,query={},body}){
 if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON.');}}
 const hash=validHash(method==='GET'?query.hash:body?.hash),Key=prefix+'shared-media/'+hash;
 const head=async key=>{try{return await s3.send(new HeadObjectCommand({Bucket,Key:key}));}catch(e){if(missing(e))return null;throw e;}};
 const verify=(o,size)=>{if(o.Metadata?.sha256!==hash||o.ContentLength<1||o.ContentLength>1048576||(size!==undefined&&o.ContentLength!==size))throw new HttpError(409,'Saved media does not match its checksum or size.');};
 if(action==='shared-status'&&method==='GET'){const o=await head(Key);if(!o)return {exists:false};verify(o);return {exists:true,hash,size:o.ContentLength};}
 if(action==='shared-get'&&method==='GET'){
  const r=await s3.send(new GetObjectCommand({Bucket,Key})),bytes=Buffer.from(await r.Body.transformToByteArray());
  if(bytes.length>1048576||digest(bytes)!==hash)throw new HttpError(409,'Shared media integrity check failed.');return bytes;
 }
 if(method!=='POST')throw new HttpError(405,'Method not allowed.');
 if(action==='shared-promote'){
  if(!Number.isSafeInteger(body.size)||body.size<1||body.size>1048576)throw new HttpError(400,'Invalid media size.');
  const existing=await head(Key);if(existing){verify(existing,body.size);return {saved:true};}
  const source=prefix+'parts/'+snapshotId(body.id)+'/'+partId(String(body.part)),o=await head(source);
  if(!o)return {saved:false};
  // Only server-written SHA metadata can authorize a copy under a content hash.
  if(o.Metadata?.sha256!==hash||o.ContentLength!==body.size||!o.ETag)return {saved:false};
  try{await s3.send(new CopyObjectCommand({Bucket,Key,CopySource:encodeURIComponent(Bucket+'/'+source),CopySourceIfMatch:o.ETag,MetadataDirective:'COPY'}));}
  catch(e){if(missing(e)||e.$metadata?.httpStatusCode===412)return {saved:false};throw e;}
  const saved=await head(Key);if(!saved)throw new HttpError(503,'Shared media copy was not confirmed.');verify(saved,body.size);return {saved:true};
 }
 if(action!=='shared-put')throw new HttpError(400,'Unknown shared media operation.');
 if(typeof body.data!=='string'||body.data.length>1398104||!body.data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw new HttpError(400,'Invalid media bytes.');
 const bytes=Buffer.from(body.data,'base64');if(!bytes.length||bytes.length>1048576||digest(bytes)!==hash)throw new HttpError(400,'Media checksum does not match.');
 try{await s3.send(new PutObjectCommand({Bucket,Key,Body:bytes,Metadata:{sha256:hash},ContentType:'application/octet-stream',CacheControl:'private, no-store',IfNoneMatch:'*'}));}
 catch(e){if(e.$metadata?.httpStatusCode!==412)throw e;const o=await head(Key);if(!o)throw e;verify(o,bytes.length);}
 return {saved:true};
}
module.exports={sharedMedia,validHash};
