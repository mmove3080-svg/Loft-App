const crypto=require('node:crypto');
function fixture(){
 const objects=new Map(),writes=[],copies=[];let serial=0;
 const seed=(key,bytes,metadata={})=>{objects.set(key,{bytes:Buffer.from(bytes),metadata,etag:'"'+(++serial)+'"'});};
 const missing=()=>Object.assign(Error('Missing'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
 const mismatch=()=>Object.assign(Error('Precondition'),{$metadata:{httpStatusCode:412}});
 const s3={send:async command=>{
  const a=command.input,n=command.constructor.name,o=objects.get(a.Key);
  if(n==='HeadObjectCommand'){if(!o)throw missing();return {ContentLength:o.bytes.length,Metadata:o.metadata,ETag:o.etag};}
  if(n==='GetObjectCommand'){if(!o)throw missing();if(a.IfMatch&&a.IfMatch!==o.etag)throw mismatch();let bytes=o.bytes;if(a.Range){const [,start,end]=/bytes=(\d+)-(\d+)/.exec(a.Range);bytes=bytes.subarray(+start,+end+1);}return {Body:{transformToByteArray:async()=>bytes},ETag:o.etag};}
  if(n==='PutObjectCommand'){if((a.IfNoneMatch==='*'&&o)||(a.IfMatch&&a.IfMatch!==o?.etag))throw mismatch();seed(a.Key,a.Body,a.Metadata);writes.push(a.Key);return {ETag:objects.get(a.Key).etag};}
  if(n==='CopyObjectCommand'){const source=decodeURIComponent(a.CopySource).slice(2),v=objects.get(source);if(!v)throw missing();if(v.etag!==a.CopySourceIfMatch)throw mismatch();seed(a.Key,v.bytes,v.metadata);copies.push({source,destination:a.Key});return {};}
  if(n==='ListObjectsV2Command')return {Contents:[...objects.keys()].filter(k=>k.startsWith(a.Prefix)).slice(0,a.MaxKeys||1000).map(Key=>({Key}))};
  if(n==='DeleteObjectsCommand'){for(const x of a.Delete.Objects)objects.delete(x.Key);return {};}
  if(n==='DeleteObjectCommand'){objects.delete(a.Key);return {};}
  throw Error(n);
 }};
 return {s3,objects,writes,copies,seed,hash:bytes=>crypto.createHash('sha256').update(bytes).digest('hex')};
}
module.exports={fixture};
