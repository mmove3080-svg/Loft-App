const assert=require('node:assert/strict');
const {device,devices}=require('./sync.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{for(let i=0;i<500;i++){if(fn())return;await delay(5);}throw Error('Timed out');};
(async()=>{
 const d=await device('controls');
 await d.write('media',{id:'large',name:'large.mov',blob:new Blob([new Uint8Array(2*1048576+30)],{type:'video/mp4'})});
 const uploads=[];let held=false,block=true;
 d.intercept(async(a,o,u)=>{
   if(a==='sync-part'&&o.method==='POST'){
     const part=Number(u.searchParams.get('part'));uploads.push(part);
     if(block&&part===1){held=true;await new Promise((resolve,reject)=>{if(o.signal.aborted)return reject(Error('aborted'));o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});}
   }
 });
 d.button('Enable automatic sync').click();await until(()=>held).catch(e=>{throw Error(e.message+' '+d.status());});
 assert(!d.button('Pause automatic sync').disabled,'Pause remains usable during upload');
 assert(!d.button('Sign out').disabled,'Sign out remains usable during upload');
 assert(!d.button('Browse synced collection').disabled,'Browse remains usable during upload');
 d.button('Browse synced collection').click();await until(()=>d.w.document.body.textContent.includes('Your cloud collection'));
 d.button('Pause automatic sync').click();await d.wait('Automatic sync is off.');
 assert.deepEqual(uploads,[0,1]);assert(await d.get('media','large'),'pause preserves local media');
 const db=d.db;d.close();
 // Reopen with the same IndexedDB; the completed first chunk must be reused.
 const reopened=await device('reopened',db);const retried=[];
 reopened.intercept(async(a,o,u)=>{if(a==='sync-part'&&o.method==='POST')retried.push(Number(u.searchParams.get('part')));});
 reopened.button('Enable automatic sync').click();await reopened.wait('Up to date');
 assert.deepEqual(retried,[1,2],'reopen skips checkpointed upload part 0');
 await reopened.write('media',{id:'next',name:'next.mov',blob:new Blob(['next'])});let stalled=false;
 reopened.intercept(async(a,o)=>{if(a==='sync-part'&&o.method==='POST'){stalled=true;await new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 reopened.button('Sync now').click();await until(()=>stalled);reopened.button('Sign out').click();await reopened.wait('Signed out on this page.');
 assert(!reopened.w.LoftCloud.status().signedIn);assert(await reopened.get('media','next'));
 const fail=await device('network-error');await fail.write('media',{id:'network',name:'network.mov',blob:new Blob([new Uint8Array(1048576+10)])});
 const attempts=[];let failOnce=true;
 fail.intercept(async(a,o,u)=>{if(a==='sync-part'&&o.method==='POST'){const p=Number(u.searchParams.get('part'));attempts.push(p);if(p===1&&failOnce){failOnce=false;throw Error('Network interrupted');}}});
 fail.button('Enable automatic sync').click();await fail.wait('Network interrupted');
 assert(!fail.button('Sign out').disabled);assert(!fail.button('Pause automatic sync').disabled);
 await fail.sync();assert.deepEqual(attempts,[0,1,1],'network retry preserves completed part');
 console.log('PASS: browse during stalled upload; Pause aborts request; checkpoint survives reopening and skips completed chunk; Sign out aborts sync and preserves local media.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>devices.forEach(d=>d.window.close()));
