const test=require('node:test'),assert=require('node:assert/strict');
const {syncIndex}=require('../lib/sync'),{fixture}=require('../checks/shared-fixture.cjs');
const DAY=86400000,source='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const record=(id,date)=>({store:'media',id,deleted:false,hash:'a'.repeat(64),source,value:['object',[['albumId',['value','family']],['id',['value',id]],...(date?[['loftDeletedAt',['value',date]]]:[])]]});
function setup(){const f=fixture();return {...f,call:(method,body,now,operation,cleanup=false)=>syncIndex({s3:f.s3,Bucket:'b',prefix:'owner/',method,body,now,operation,cleanup})};}
test('gallery deletion keeps bytes until day 30; cron purges without another recovery period',async()=>{
 const f=setup(),now=1700000000000;
 f.seed('owner/sync/parts/'+source+'/0','original');
 await f.call('POST',{revision:null,entries:[record('a',now)]},now);
 let state=await f.call('GET',null,now);assert.equal(state.entries[0].recycle.expiresAt,now+30*DAY);assert.equal(state.pendingCleanup,0);
 assert.equal((await f.call('POST',{},now+30*DAY-1,'expire')).expired,0);
 assert.equal((await f.call('POST',{},now+30*DAY,'expire')).expired,1);
 state=await f.call('GET',null,now+30*DAY);assert(state.entries[0].deleted);assert.equal(state.trash.length,0);assert.equal(state.pendingCleanup,1);
 await f.call('POST',{},now+30*DAY,undefined,true);assert(!f.objects.has('owner/sync/parts/'+source+'/0'));
});
test('restore preserves album and original source; expired restore and stale revisions fail',async()=>{
 const f=setup(),now=1700000000000;await f.call('POST',{revision:null,entries:[record('a',now)]},now);
 let state=await f.call('GET',null,now),entry=record('a');
 await assert.rejects(f.call('POST',{revision:'stale',store:'media',id:'a',restored:{value:entry.value,hash:entry.hash}},now+1,'restore'),{status:409});
 await assert.rejects(f.call('POST',{revision:state.revision,store:'media',id:'a',restored:{value:entry.value,hash:entry.hash}},now+30*DAY,'restore'),{status:409});
 await f.call('POST',{revision:state.revision,store:'media',id:'a',restored:{value:entry.value,hash:entry.hash}},now+1,'restore');
 state=await f.call('GET',null,now);assert.deepEqual(state.entries,[entry]);assert.equal(state.pendingCleanup,0);
});
test('permanent gallery removal never recreates cloud Trash; unrelated live records stay',async()=>{
 const f=setup(),now=1700000000000;await f.call('POST',{revision:null,entries:[record('a',now),record('b')]},now);
 let state=await f.call('GET',null,now);
 await f.call('POST',{revision:state.revision,entries:[{store:'media',id:'a',deleted:true},record('b')]},now+1);
 state=await f.call('GET',null,now);assert.equal(state.trash.length,0);assert(!state.entries[1].deleted);assert.equal(state.pendingCleanup,0,'source shared with active item remains protected');
});
test('first sync after offline retention expiry creates only tombstone; clocks cannot reset retention',async()=>{
 const f=setup(),now=1700000000000;
 await f.call('POST',{revision:null,entries:[record('expired',now-31*DAY),record('a',now)]},now);
 let state=await f.call('GET',null,now);assert(state.entries[0].deleted);assert.equal(state.trash.length,0);
 await assert.rejects(f.call('POST',{revision:state.revision,entries:[state.entries[0],record('a',now+1)]},now+1),{status:409});
 await assert.rejects(f.call('POST',{revision:state.revision,entries:[state.entries[0],record('a',now+DAY)]},now),{status:400});
});
