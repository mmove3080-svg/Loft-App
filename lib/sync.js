'use strict';
const {GetObjectCommand,PutObjectCommand,ListObjectsV2Command,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {HttpError,snapshotId}=require('./security');
const {refs}=require('./snapshots');
const allowed=['media','notes','contacts','chats'];
const keyOf=e=>JSON.stringify([e.store,e.id]);
function validate(entries){
 if(!Array.isArray(entries)||entries.length>10000)throw new HttpError(400,'The sync collection is limited to 10,000 records including deletions.');
 const keys=new Set();
 for(const e of entries){
  if(!e||!allowed.includes(e.store)||typeof e.id!=='string'||!e.id||e.id.length>256||typeof e.deleted!=='boolean')throw new HttpError(400,'Invalid sync entry.');
  const key=keyOf(e);if(keys.has(key))throw new HttpError(400,'Duplicate sync entry.');keys.add(key);
  if(!e.deleted){if(!/^[a-f0-9]{64}$/.test(e.hash))throw new HttpError(400,'Invalid content hash.');snapshotId(e.source);refs(e.value);}
 }
 return keys;
}
async function syncIndex({s3,Bucket,prefix,method,body,cleanup=false}){
 const Key=prefix+'sync/current.json';let current={entries:[]},revision=null;
 try{const r=await s3.send(new GetObjectCommand({Bucket,Key}));current=JSON.parse(Buffer.from(await r.Body.transformToByteArray()).toString());revision=r.ETag;if(!revision)throw new HttpError(503,'Sync version unavailable.');}
 catch(e){if(e.name!=='NoSuchKey'&&e.$metadata?.httpStatusCode!==404)throw e;}
 if(cleanup){
  if(method!=='POST')throw new HttpError(405,'Method not allowed.');
  const garbage=current.garbage||[];if(!garbage.length)return {done:true};
  const source=snapshotId(garbage[0]);
  if(current.entries.some(e=>!e.deleted&&e.source===source))throw new HttpError(409,'Media is still in use.');
  const Prefix=prefix+'sync/parts/'+source+'/';
  const page=await s3.send(new ListObjectsV2Command({Bucket,Prefix,MaxKeys:200}));
  const keys=(page.Contents||[]).map(x=>x.Key);
  if(keys.some(k=>!k.startsWith(Prefix)))throw new HttpError(503,'Unexpected storage response.');
  if(keys.length){const r=await s3.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:keys.map(Key=>({Key})),Quiet:true}}));if(r.Errors?.length)throw new HttpError(503,'Media cleanup failed. Retry cleanup.');return {done:false};}
  await s3.send(new PutObjectCommand({Bucket,Key,Body:JSON.stringify({...current,garbage:garbage.slice(1)}),ContentType:'application/json',CacheControl:'private, no-store',IfMatch:revision}));
  return {done:garbage.length===1};
 }
 if(method==='GET')return {entries:current.entries,revision,pendingCleanup:(current.garbage||[]).length};
 if(method!=='POST')throw new HttpError(405,'Method not allowed.');
 if(!body||body.revision!==revision)throw new HttpError(409,'Cloud data changed. Sync will retry.');
 const keys=validate(body.entries);
 for(const e of current.entries)if(!keys.has(keyOf(e)))throw new HttpError(400,'Sync entries must be deleted explicitly, not omitted.');
 const garbage=new Set(current.garbage||[]),active=new Set(body.entries.filter(e=>!e.deleted).map(e=>e.source));
 for(const source of active)if(garbage.has(source))throw new HttpError(409,'This media version was retired. Upload a new version.');
 for(const e of current.entries)if(!e.deleted&&!active.has(e.source))garbage.add(e.source);
 const bytes=JSON.stringify({version:1,entries:body.entries,garbage:[...garbage],updatedAt:new Date().toISOString()});
 if(Buffer.byteLength(bytes)>3000000)throw new HttpError(413,'Sync metadata exceeds 3 MB. Your local data remains available.');
 const r=await s3.send(new PutObjectCommand({Bucket,Key,Body:bytes,ContentType:'application/json',CacheControl:'private, no-store',...(revision?{IfMatch:revision}:{IfNoneMatch:'*'})}));
 return {saved:true,revision:r.ETag};
}
module.exports={syncIndex,validate};
