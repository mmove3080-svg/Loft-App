const test=require('node:test'),assert=require('node:assert/strict');
const {manage}=require('../lib/snapshots');
const prefix='loft-private/v1/owner/',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',key=prefix+'commits/'+id+'.json',pp=prefix+'parts/'+id+'/';
const value=n=>['object',[['id',['value','record'+n]],['blob',['blob',{size:1,type:'image/png',parts:[{number:n,hash:'abc'}]}]]]];
function fixture(){
 let revision=1,fail=false;const files=new Map([[key,JSON.stringify({version:1,records:[{store:'media',value:value(0)},{store:'media',value:value(1)}]})],[pp+'0','a'],[pp+'1','b'],[prefix+'parts/other/0','untouched']]);
 const commands=[];
 const s3={send:async cmd=>{const a=cmd.input,name=cmd.constructor.name;commands.push({name,a});
  if(name==='GetObjectCommand'){if(!files.has(a.Key))throw Error('missing');return {ETag:'"'+revision+'"',Body:{transformToByteArray:async()=>Buffer.from(files.get(a.Key))}};}
  if(name==='PutObjectCommand'){assert.equal(a.IfMatch,'"'+revision+'"');files.set(a.Key,a.Body);revision++;return {};}
  if(name==='ListObjectsV2Command')return {Contents:[...files.keys()].filter(k=>k.startsWith(a.Prefix)).slice(0,a.MaxKeys).map(Key=>({Key}))};
  if(name==='DeleteObjectsCommand'){if(fail)return {Errors:[{Code:'AccessDenied'}]};for(const {Key} of a.Delete.Objects)files.delete(Key);return {};}
  if(name==='DeleteObjectCommand'){files.delete(a.Key);return {};}
  throw Error(name);
 }};
 return {files,commands,setFail:x=>fail=x,call:(action,body)=>manage({s3,Bucket:'bucket',prefix,id,action,body})};
}
test('browse returns contents and revision without writes',async()=>{const f=fixture();const r=await f.call('browse');assert.equal(r.manifest.records.length,2);assert.equal(r.revision,'"1"');assert.equal(f.commands.length,1);});
test('stale or invalid selections cannot delete',async()=>{const f=fixture();await assert.rejects(f.call('remove-record',{revision:'old',index:0}),{status:409});await assert.rejects(f.call('remove-record',{revision:'"1"',index:9}),{status:400});assert.equal(f.files.size,4);});
test('item removal and cleanup preserve retained media and other backups',async()=>{const f=fixture();await f.call('remove-record',{revision:'"1"',index:0});assert.equal(JSON.parse(f.files.get(key)).records.length,1);await f.call('cleanup');assert(!f.files.has(pp+'0'));assert(f.files.has(pp+'1'));assert.equal(f.files.get(prefix+'parts/other/0'),'untouched');});
test('cleanup errors are reported and retryable',async()=>{const f=fixture();await f.call('remove-record',{revision:'"1"',index:0});f.setFail(true);await assert.rejects(f.call('cleanup'),{status:503});f.setFail(false);await f.call('cleanup');assert(!f.files.has(pp+'0'));});
test('whole backup deletion marks first, survives interruption and only removes its files',async()=>{const f=fixture();assert.equal((await f.call('delete-snapshot',{revision:'"1"'})).done,false);assert(JSON.parse(f.files.get(key)).deleting);await assert.rejects(f.call('remove-record',{revision:'"2"',index:0}),{status:409});f.setFail(true);await assert.rejects(f.call('delete-snapshot',{}),{status:503});assert(f.files.has(key));f.setFail(false);await f.call('delete-snapshot',{});assert.equal((await f.call('delete-snapshot',{})).done,true);assert.equal(f.files.size,1);assert(f.files.has(prefix+'parts/other/0'));});
