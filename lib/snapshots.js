'use strict';
const {GetObjectCommand,PutObjectCommand,ListObjectsV2Command,DeleteObjectsCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const {HttpError,partId}=require('./security');
function refs(value,out=new Set(),depth=0){
  if(depth>40||!Array.isArray(value))throw new HttpError(400,'Invalid snapshot data.');
  const [tag,data]=value;
  if(tag==='blob'){
    if(!data||!Array.isArray(data.parts))throw new HttpError(400,'Invalid media data.');
    for(const p of data.parts)out.add(partId(String(p.number)));
  } else if(tag==='object') {for(const pair of data)refs(pair[1],out,depth+1);}
  else if(tag==='array'){for(const v of data)refs(v,out,depth+1);}
  else if(!['value','date','undefined'].includes(tag))throw new HttpError(400,'Unknown snapshot format.');
  return out;
}
async function manage({s3,Bucket,prefix,id,action,body={}}){
  const Key=prefix+'commits/'+id+'.json', partPrefix=prefix+'parts/'+id+'/';
  const object=await s3.send(new GetObjectCommand({Bucket,Key}));
  const manifest=JSON.parse(Buffer.from(await object.Body.transformToByteArray()).toString());
  if(manifest.version!==1||!Array.isArray(manifest.records))throw new HttpError(400,'Unsupported snapshot.');
  const revision=object.ETag;
  if(!revision)throw new HttpError(503,'Could not verify the backup version.');
  if(action==='browse')return {manifest,revision};
  const put=async value=>s3.send(new PutObjectCommand({Bucket,Key,Body:JSON.stringify(value),ContentType:'application/json',CacheControl:'private, no-store',IfMatch:revision}));
  const erase=async keys=>{
    if(!keys.length)return;
    const r=await s3.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:keys.map(Key=>({Key})),Quiet:true}}));
    if(r.Errors&&r.Errors.length)throw new HttpError(503,'Some cloud files could not be removed. Retry the operation.');
  };
  if(action==='remove-record'){
    if(manifest.deleting)throw new HttpError(409,'This backup is being deleted.');
    if(body.revision!==revision)throw new HttpError(409,'This backup changed. Open it again before deleting.');
    if(!Number.isInteger(body.index)||body.index<0||body.index>=manifest.records.length)throw new HttpError(400,'Invalid item selection.');
    // Validate references before changing anything. All keys remain inside this backup.
    for(const r of manifest.records)refs(r.value);
    manifest.records.splice(body.index,1);
    await put(manifest);
    return {removed:true};
  }
  if(action==='cleanup'){
    if(manifest.deleting)throw new HttpError(409,'Resume deleting this backup instead.');
    const keep=new Set();for(const r of manifest.records)refs(r.value,keep);
    if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>4096))throw new HttpError(400,'Invalid cursor.');
    const page=await s3.send(new ListObjectsV2Command({Bucket,Prefix:partPrefix,MaxKeys:200,ContinuationToken:body.cursor||undefined}));
    const keys=(page.Contents||[]).map(x=>x.Key).filter(k=>k.startsWith(partPrefix)&&!keep.has(k.slice(partPrefix.length)));
    await erase(keys);
    return {cursor:page.NextContinuationToken||null};
  }
  if(action==='delete-snapshot'){
    if(!manifest.deleting){
      if(body.revision!==revision)throw new HttpError(409,'This backup changed. Refresh the list before deleting.');
      await put({...manifest,deleting:true});
      return {done:false};
    }
    // Keep a visible deletion marker until every part has gone; interrupted deletes resume.
    const page=await s3.send(new ListObjectsV2Command({Bucket,Prefix:partPrefix,MaxKeys:200}));
    const keys=(page.Contents||[]).map(x=>x.Key);
    if(keys.some(k=>!k.startsWith(partPrefix)))throw new HttpError(503,'Unexpected storage response.');
    if(keys.length){await erase(keys);return {done:false};}
    await s3.send(new DeleteObjectCommand({Bucket,Key}));
    return {done:true};
  }
  throw new HttpError(400,'Unknown management action.');
}
module.exports={manage,refs};
