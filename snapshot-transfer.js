/* Large snapshot indexes use bounded requests; originals and snapshot IDs stay unchanged. */
(function(global){
'use strict';
const CHUNK=1048576,MAX=64*CHUNK;
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
async function commit(id,manifest,io){
 const blob=new Blob([JSON.stringify(manifest)]);
 if(blob.size<=3000000)return io.request('commit',{id},manifest);
 if(blob.size>MAX)throw new Error('Snapshot index exceeds 64 MB. Uploaded media and progress are preserved.');
 const hash=await io.hash(blob),pages=Math.ceil(blob.size/CHUNK);
 for(let page=0;page<pages;page++){
  if(io.progress)io.progress(page,pages);
  await io.request('index-chunk',{id},{hash,page,data:base64(new Uint8Array(await blob.slice(page*CHUNK,(page+1)*CHUNK).arrayBuffer()))});
 }
 if(io.progress)io.progress(pages,pages);
 return io.request('index-finalize',{id},{hash,size:blob.size});
}
async function read(id,request){
 const info=await(await request('index-info',{id})).json();
 if(!Number.isSafeInteger(info.size)||info.size<1||info.size>MAX||info.chunkSize!==CHUNK||typeof info.revision!=='string')throw new Error('Invalid snapshot index information.');
 const chunks=[];
 for(let page=0;page<Math.ceil(info.size/CHUNK);page++){
  const r=await(await request('index-page',{id,page:String(page),revision:info.revision})).json(),s=atob(r.data);
  if(s.length!==Math.min(CHUNK,info.size-page*CHUNK))throw new Error('Incomplete snapshot index. Try opening it again.');
  chunks.push(Uint8Array.from(s,c=>c.charCodeAt(0)));
 }
 const manifest=JSON.parse(await new Blob(chunks).text());
 if(manifest.version!==1||!Array.isArray(manifest.records))throw new Error('Unsupported snapshot.');
 return {manifest,revision:info.revision};
}
async function readSync(request){
 const info=await(await request('sync-index-info')).json();
 if(info.empty)return {entries:[],trash:[],revision:null};
 if(!Number.isSafeInteger(info.size)||info.size<1||info.size>MAX||info.chunkSize!==CHUNK||typeof info.revision!=='string')throw new Error('Invalid sync index information.');
 const chunks=[];
 for(let page=0;page<Math.ceil(info.size/CHUNK);page++){
  const r=await(await request('sync-index-page',{page:String(page),revision:info.revision})).json(),s=atob(r.data);
  if(s.length!==Math.min(CHUNK,info.size-page*CHUNK))throw new Error('Incomplete sync index. Retry sync.');
  chunks.push(Uint8Array.from(s,c=>c.charCodeAt(0)));
 }
 const data=JSON.parse(await new Blob(chunks).text());
 if(!Array.isArray(data.entries))throw new Error('Invalid sync collection.');
 return {...data,trash:data.trash||[],revision:info.revision};
}
async function commitSync(body,io){
 const blob=new Blob([JSON.stringify(body)]);
 if(blob.size<=3000000)return io.request('sync-index',{},body);
 if(blob.size>MAX)throw new Error('Sync index exceeds 64 MB. Local data and backups are preserved.');
 const hash=await io.hash(blob);
 for(let page=0;page<Math.ceil(blob.size/CHUNK);page++)await io.request('sync-index-chunk',{}, {hash,page,data:base64(new Uint8Array(await blob.slice(page*CHUNK,(page+1)*CHUNK).arrayBuffer()))});
 return io.request('sync-index-finalize',{}, {hash,size:blob.size});
}
global.LoftSnapshotTransfer={commit,read,readSync,commitSync};
if(typeof module!=='undefined')module.exports=global.LoftSnapshotTransfer;
})(typeof window!=='undefined'?window:globalThis);
