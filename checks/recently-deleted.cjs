const assert=require('node:assert/strict'),fs=require('fs');
const {device,devices,files}=require('./sync.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const a=await device('trash-A'),b=await device('trash-B');
 for(const d of [a,b]){d.w.eval(fs.readFileSync('media-store.js','utf8'));d.media=d.w.LoftMedia.create(async()=>d.db);}
 await a.write('albums',{id:'family',name:'Family'});
 await a.write('media',{id:'photo',name:'photo.jpg',kind:'image',albumId:'family',blob:new Blob(['original photo'],{type:'image/jpeg'})});
 await a.write('media',{id:'video',name:'video.mov',kind:'video',albumId:'family',blob:new Blob(['original video'],{type:'video/mp4'})});
 a.button('Enable automatic sync').click();await a.wait('Up to date');b.button('Enable automatic sync').click();await b.wait('Up to date');
 const initialParts=[...files.keys()].filter(k=>k.includes('/sync/parts/'));
 await a.media.remove(['photo','video']);assert.equal((await a.media.scan()).length,0);assert.equal((await a.media.scan(undefined,true)).length,2);const deletedAt=(await a.media.get('photo')).loftDeletedAt;
 await a.media.remove(['photo']);assert.equal((await a.media.get('photo')).loftDeletedAt,deletedAt,'repeat deletion cannot reset 30 days');
 await a.sync();await b.sync();assert.equal((await b.media.scan()).length,0);assert.equal((await b.media.scan(undefined,true)).length,2);assert.equal(await (await b.media.get('video')).blob.text(),'original video');
 assert.deepEqual([...files.keys()].filter(k=>k.includes('/sync/parts/')),initialParts,'delete only changes metadata, no duplicate originals');
 await b.media.restore(['photo','video']);await b.sync();await a.sync();assert.equal((await a.media.scan()).length,2);assert.equal((await a.media.get('photo')).albumId,'family');assert.equal((await a.media.get('photo')).loftDeletedAt,undefined);
 assert.deepEqual([...files.keys()].filter(k=>k.includes('/sync/parts/')),initialParts,'restore reuses original cloud bytes');
 // Never-synced deletion and restore still work offline and reach the other device later.
 a.online(false);await a.write('media',{id:'offline',name:'offline.jpg',kind:'image',albumId:'missing',blob:new Blob(['offline original'])});
 await a.media.remove(['offline']);assert.equal((await a.media.scan(undefined,true)).filter(x=>x.loftDeletedAt).length,1);await a.media.restore(['offline']);assert.equal((await a.media.get('offline')).albumId,null);
 await a.media.remove(['offline']);a.online(true);await a.sync();await b.sync();assert((await b.media.get('offline')).loftDeletedAt);
 await b.media.purge(['offline']);assert.equal(await b.media.get('offline'),undefined);await b.sync();await a.sync();assert.equal(await a.media.get('offline'),undefined);assert.equal(JSON.parse(files.get('owner/sync/current.json')).trash.length,0);
 // Delete and permanently purge before the next sync must not create a new cloud recovery period.
 await a.media.remove(['photo']);await a.media.purge(['photo']);await a.sync();await b.sync();assert.equal(await b.media.get('photo'),undefined);assert.equal(JSON.parse(files.get('owner/sync/current.json')).trash.length,0);
 // Expiry on a device removes bytes and persists a deletion marker before reconnecting.
 const past=Date.now()-31*86400000;await a.write('media',{...(await a.media.get('video')),loftDeletedAt:past});
 assert.equal(await a.media.expire(),1);assert.equal(await a.media.get('video'),undefined);assert(await a.get('kv','media-purge-v1:video'));await a.sync();await b.sync();assert.equal(await b.media.get('video'),undefined);
 // Reopening the same database preserves recovery records and album membership.
 await a.write('media',{id:'persist',name:'persist.jpg',albumId:'family',blob:new Blob(['persist'])});await a.media.remove(['persist']);const reopened=a.w.LoftMedia.create(async()=>a.db);assert.equal((await reopened.scan(undefined,true)).length,1);await reopened.restore(['persist']);assert.equal((await reopened.get('persist')).albumId,'family');
 // Concurrent restore versus permanent deletion must ask the user, not resurrect silently.
 await a.sync();await b.sync();await a.media.remove(['persist']);await a.sync();await b.sync();
 await b.media.restore(['persist']);await a.media.purge(['persist']);await a.sync();await b.sync('conflicting item');
 assert(await b.media.get('persist'),'conflict preserves local choice until resolved');
 assert(JSON.parse(files.get('owner/sync/current.json')).entries.find(e=>e.id==='persist').deleted,'cloud stays permanently deleted until conflict is resolved');
 console.log('PASS: offline deletion/recovery, 30-day clock, photo/video original bytes, original/missing albums, two-device delete/restore/purge, no duplicate media writes, expiry and reopen persistence.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>devices.forEach(d=>d.window.close()));
