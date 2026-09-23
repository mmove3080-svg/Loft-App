const test=require('node:test'),assert=require('node:assert/strict');
const {plan,keyOf}=require('../sync-engine');
const {syncIndex,validate}=require('../lib/sync');
const e=(hash,id='n')=>({store:'notes',id,hash,deleted:false});
const base=x=>({[keyOf(e(x))]:x});
test('first sync merges disjoint records without interpreting missing local data as deletion',()=>{const p=plan([e('a')],[e('b','other')]);assert.equal(p.push.length,1);assert.equal(p.pull.length,1);assert.equal(p.conflicts.length,0);});
test('unchanged records are not uploaded again',()=>{const p=plan([e('a')],[e('a')],base('a'));assert.equal(p.push.length+p.pull.length,0);});
test('offline edits upload; remote edits download',()=>{assert.equal(plan([e('b')],[e('a')],base('a')).push.length,1);assert.equal(plan([e('a')],[e('b')],base('a')).pull.length,1);});
test('local and remote deletions propagate only after common baseline',()=>{assert(plan([],[e('a')],base('a')).push[0].deleted);assert(plan([e('a')],[{store:'notes',id:'n',deleted:true}],base('a')).pull[0].deleted);});
test('concurrent edits and edit/delete conflicts pause without mutations',()=>{for(const l of [[e('b')],[]]){const p=plan(l,[e('c')],base('a'));assert.equal(p.conflicts.length,1);assert.equal(p.push.length+p.pull.length,0);}});
test('conflict choices only apply to the exact reviewed versions',()=>{const key=keyOf(e('x')),choices={[key]:{direction:'push',local:'b',remote:'c'}};assert.equal(plan([e('b')],[e('c')],base('a'),choices).push.length,1);assert.equal(plan([e('changed')],[e('c')],base('a'),choices).conflicts.length,1);});
test('new device with stale copy cannot silently resurrect deleted cloud item',()=>{assert.equal(plan([e('a')],[{store:'notes',id:'n',deleted:true}]).conflicts.length,1);});
test('sync rejects duplicate IDs and unsafe media paths',()=>{assert.throws(()=>validate([{...e('a'.repeat(64)),source:'../bad',value:['value','x']}]),{status:400});assert.throws(()=>validate([{store:'notes',id:'x',deleted:true},{store:'notes',id:'x',deleted:true}]),{status:400});});
function fixture(){let data,rev=0;const files=new Map(),calls=[];return {files,calls,call:(method,body,cleanup=false,operation,now)=>syncIndex({Bucket:'b',prefix:'owner/',method,body,cleanup,operation,now,s3:{send:async c=>{const i=c.input,n=c.constructor.name;calls.push(c);
 if(n==='GetObjectCommand'){if(!data)throw Object.assign(Error('missing'),{name:'NoSuchKey'});return {ETag:String(rev),Body:{transformToByteArray:async()=>Buffer.from(data)}};}
 if(n==='PutObjectCommand'){if(i.IfMatch!==undefined)assert.equal(i.IfMatch,String(rev));else assert.equal(i.IfNoneMatch,'*');data=i.Body;return {ETag:String(++rev)};}
 if(n==='ListObjectsV2Command')return {Contents:[...files.keys()].filter(k=>k.startsWith(i.Prefix)).map(Key=>({Key}))};
 if(n==='DeleteObjectsCommand'){for(const x of i.Delete.Objects)files.delete(x.Key);return {};}
 throw Error(n);
 }}})};}
const source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const full={...e('a'.repeat(64)),source,value:['object',[['id',['value','n']]]]};
test('sync index uses conditional writes, rejects stale saves and omitted entries',async()=>{const f=fixture();assert.equal((await f.call('GET')).revision,null);await f.call('POST',{revision:null,entries:[full]});await assert.rejects(f.call('POST',{revision:null,entries:[]}),{status:409});await assert.rejects(f.call('POST',{revision:'1',entries:[]}),{status:400});});
test('Trash protects payload and media for 30 days; expiry preserves backups and deletion markers',async()=>{
 const f=fixture(),now=1000000;await f.call('POST',{revision:null,entries:[full]},false,undefined,now);
 f.files.set('owner/sync/parts/'+source+'/0','old');f.files.set('owner/parts/backup/0','keep');
 await f.call('POST',{revision:'1',entries:[{store:'notes',id:'n',deleted:true,expiresAt:0}]},false,undefined,now);
 let state=await f.call('GET');assert.equal(state.pendingCleanup,0);assert.equal(state.trash[0].expiresAt,now+30*86400000);
 assert.equal((await f.call('POST',{},true)).done,true);assert.equal(f.files.size,2);
 // Older clients do not send Trash; they must not erase it or reset its clock.
 await f.call('POST',{revision:'2',entries:state.entries},false,undefined,now+100);
 state=await f.call('GET');assert.equal(state.trash[0].deletedAt,now);
 assert.equal((await f.call('POST',{},false,'expire',now+30*86400000-1)).expired,0);
 assert.equal((await f.call('POST',{},false,'expire',now+30*86400000)).expired,1);
 assert.equal((await f.call('GET')).entries[0].deleted,true);
 await f.call('POST',{},true);await f.call('POST',{},true);assert.equal(f.files.size,1);assert(f.files.has('owner/parts/backup/0'));
});
test('restore is conditional and retains media; expired Trash cannot be restored',async()=>{
 const f=fixture(),now=1000000;await f.call('POST',{revision:null,entries:[full]});await f.call('POST',{revision:'1',entries:[{store:'notes',id:'n',deleted:true}]},false,undefined,now);
 await assert.rejects(f.call('POST',{revision:'1',store:'notes',id:'n'},false,'restore',now+1),{status:409});
 await assert.rejects(f.call('POST',{revision:'2',store:'notes',id:'n'},false,'restore',now+30*86400000),{status:409});
 await f.call('POST',{revision:'2',store:'notes',id:'n'},false,'restore',now+1);
 const result=await f.call('GET');assert.equal(result.trash.length,0);assert.deepEqual(result.entries,[full]);assert.equal(result.pendingCleanup,0);
});
test('purge queues only unused sources; shared active media stays protected',async()=>{
 const f=fixture();await f.call('POST',{revision:null,entries:[full,{...full,id:'other'}]});await f.call('POST',{revision:'1',entries:[{store:'notes',id:'n',deleted:true},{...full,id:'other'}]});
 await f.call('POST',{revision:'2',store:'notes',id:'n'},false,'purge');const result=await f.call('GET');assert.equal(result.trash.length,0);assert.equal(result.pendingCleanup,0);
});
test('replaced active sources still clean up, and cannot be reused while cleanup is pending',async()=>{
 const f=fixture();await f.call('POST',{revision:null,entries:[full]});await f.call('POST',{revision:'1',entries:[{...full,source:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]});
 assert.equal((await f.call('GET')).pendingCleanup,1);await assert.rejects(f.call('POST',{revision:'2',entries:[full]}),{status:409});
});
