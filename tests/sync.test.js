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
function fixture(){let data,rev=0;const files=new Map(),calls=[];return {files,calls,call:(method,body,cleanup=false)=>syncIndex({Bucket:'b',prefix:'owner/',method,body,cleanup,s3:{send:async c=>{const i=c.input,n=c.constructor.name;calls.push(c);
 if(n==='GetObjectCommand'){if(!data)throw Object.assign(Error('missing'),{name:'NoSuchKey'});return {ETag:String(rev),Body:{transformToByteArray:async()=>Buffer.from(data)}};}
 if(n==='PutObjectCommand'){if(i.IfMatch!==undefined)assert.equal(i.IfMatch,String(rev));else assert.equal(i.IfNoneMatch,'*');data=i.Body;return {ETag:String(++rev)};}
 if(n==='ListObjectsV2Command')return {Contents:[...files.keys()].filter(k=>k.startsWith(i.Prefix)).map(Key=>({Key}))};
 if(n==='DeleteObjectsCommand'){for(const x of i.Delete.Objects)files.delete(x.Key);return {};}
 throw Error(n);
 }}})};}
const source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const full={...e('a'.repeat(64)),source,value:['object',[['id',['value','n']]]]};
test('sync index uses conditional writes, rejects stale saves and omitted entries',async()=>{const f=fixture();assert.equal((await f.call('GET')).revision,null);await f.call('POST',{revision:null,entries:[full]});await assert.rejects(f.call('POST',{revision:null,entries:[]}),{status:409});await assert.rejects(f.call('POST',{revision:'1',entries:[]}),{status:400});});
test('retired media cleanup removes only unreferenced sync files and preserves backups',async()=>{const f=fixture();await f.call('POST',{revision:null,entries:[full]});f.files.set('owner/sync/parts/'+source+'/0','old');f.files.set('owner/parts/backup/0','keep');await f.call('POST',{revision:'1',entries:[{store:'notes',id:'n',deleted:true}]});assert.equal((await f.call('GET')).pendingCleanup,1);await assert.rejects(f.call('POST',{revision:'2',entries:[full]}),{status:409});assert.equal((await f.call('POST',{},true)).done,false);assert.equal((await f.call('POST',{},true)).done,true);assert.equal(f.files.size,1);assert(f.files.has('owner/parts/backup/0'));});
