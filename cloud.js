/* Private cloud snapshots. Loaded only as public application code; credentials stay on the server. */
(function () {
  'use strict';
  const recoveryParams = new URLSearchParams(location.hash.slice(1));
  if (recoveryParams.get('type') === 'recovery' || recoveryParams.has('error_description')) {
    location.replace('/reset.html' + location.hash);
    return;
  }
  const stores = ['media', 'notes', 'contacts', 'chats'];
  let config, session, refreshing, busy = false;
  const apiURL = '/api/cloud';
  const uuid = () => crypto.randomUUID();
  function node(tag, text) { const n = document.createElement(tag); if (text) n.textContent = text; return n; }
  async function result(response) {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || body.msg || body.error_description || 'Request failed (' + response.status + ').');
    }
    return response;
  }
  async function getConfig() {
    if (!config) config = await (await result(await fetch(apiURL + '?action=config', {cache: 'no-store'}))).json();
    return config;
  }
  async function auth(grant, body) {
    const c = await getConfig();
    const r = await result(await fetch(c.url + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST', signal: AbortSignal.timeout(30000), headers: {'Content-Type': 'application/json', apikey: c.publishableKey}, body: JSON.stringify(body), cache: 'no-store'
    }));
    const data = await r.json();
    return {...data, expires_at: Date.now() + data.expires_in * 1000};
  }
  async function token() {
    if (!session) throw new Error('Please sign in.');
    if (session.expires_at < Date.now() + 60000) {
      if (!refreshing) refreshing = auth('refresh_token', {refresh_token: session.refresh_token}).then(s => {session = s;}).finally(() => {refreshing = null;});
      await refreshing;
    }
    return session.access_token;
  }
  async function request(action, params = {}, body) {
    const access = await token();
    return result(await fetch(apiURL + '?' + new URLSearchParams({action, ...params}), {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store', signal: AbortSignal.timeout(60000),
      headers: {Authorization: 'Bearer ' + access, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
  }
  async function hash(blob) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('');
  }
  function base64(bytes) {
    let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s);
  }
  // All objects have explicit tags, so a note containing JSON cannot become a blob reference.
  async function encode(value, blobHandler) {
    if (value instanceof Blob) return ['blob', await blobHandler(value)];
    if (value instanceof Date) return ['date', value.toISOString()];
    if (value === undefined) return ['undefined'];
    if (Array.isArray(value)) {const out = []; for (const v of value) out.push(await encode(v, blobHandler)); return ['array', out];}
    if (value !== null && typeof value === 'object') {
      const entries = []; for (const k of Object.keys(value).sort()) entries.push([k, await encode(value[k], blobHandler)]);
      return ['object', entries];
    }
    return ['value', value];
  }
  async function decode(v, blobHandler, depth = 0) {
    if (depth > 40 || !Array.isArray(v)) throw new Error('Invalid snapshot data.');
    const [tag, data] = v;
    if (tag === 'value') {if (data !== null && !['string','boolean','number'].includes(typeof data)) throw new Error('Invalid value.'); return data;}
    if (tag === 'undefined') return undefined;
    if (tag === 'date') return new Date(data);
    if (tag === 'blob') return blobHandler(data);
    if (tag === 'array') {const a = []; for (const x of data) a.push(await decode(x, blobHandler, depth+1)); return a;}
    if (tag === 'object') {
      const obj = {}; for (const [k, x] of data) {
        if (typeof k !== 'string' || ['__proto__','constructor','prototype'].includes(k)) throw new Error('Invalid property.');
        obj[k] = await decode(x, blobHandler, depth+1);
      } return obj;
    }
    throw new Error('Unsupported snapshot format.');
  }
  async function fingerprint(v) {return JSON.stringify(await encode(v, async b => ({hash: await hash(b), type: b.type})));}
  async function readLocal(bridge) {
    const db = await bridge.openDB();
    if (!db) throw new Error('Persistent local storage is unavailable. Cloud operations stopped to protect your records.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readonly'), records = [];
      for (const store of stores) {
        const r = tx.objectStore(store).getAll();
        r.onsuccess = () => {for (const value of r.result) records.push({store, value});};
      }
      tx.oncomplete = () => resolve(records);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not read local data.'));
    });
  }
  async function save(bridge, progress) {
    const records = await readLocal(bridge), id = uuid();
    let part = 0, uploaded = 0;
    const encoded = [];
    for (let i = 0; i < records.length; i++) {
      progress('Saving record ' + (i+1) + ' of ' + records.length + '…');
      encoded.push({store: records[i].store, value: await encode(records[i].value, async blob => {
        const parts = [];
        for (let offset = 0; offset < blob.size; offset += 1048576) {
          const slice = blob.slice(offset, offset + 1048576), number = part++;
          if (part > 1000000) throw new Error('This snapshot has too many upload parts.');
          const digest = await hash(slice);
          await request('part', {id, part: String(number)}, {data: base64(new Uint8Array(await slice.arrayBuffer()))});
          parts.push({number, hash: digest}); uploaded += slice.size;
          progress('Uploaded ' + (uploaded / 1048576).toFixed(1) + ' MB · record ' + (i+1) + '/' + records.length);
        }
        return {type: blob.type, size: blob.size, parts};
      })});
    }
    const manifest = {version: 1, createdAt: new Date().toISOString(), parts: part, records: encoded};
    if (new Blob([JSON.stringify(manifest)]).size > 3000000) throw new Error('Snapshot metadata exceeds the 3 MB limit. The snapshot was not committed.');
    await request('commit', {id}, manifest);
    progress('Saved ' + records.length + ' records to a new cloud snapshot. Changes made afterward need another save.');
  }
  async function importSnapshot(bridge, id, progress) {
    const db = await bridge.openDB();
    if (!db) throw new Error('Persistent local storage is unavailable.');
    const prior = await new Promise((resolve, reject) => {const r = db.transaction('kv').objectStore('kv').get('cloud-import:' + id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);});
    if (prior) throw new Error('This snapshot has already been imported on this device.');
    const manifest = await (await request('commit', {id})).json();
    if(manifest.deleting)throw new Error('This backup is being deleted.');
    if (manifest.version !== 1 || !Array.isArray(manifest.records)) throw new Error('Unsupported snapshot.');
    const decoded = [];
    for (let i = 0; i < manifest.records.length; i++) {
      const r = manifest.records[i];
      if (!stores.includes(r.store)) throw new Error('Invalid record type.');
      progress('Downloading record ' + (i+1) + ' of ' + manifest.records.length + '…');
      const value = await decode(r.value, async info => {
        if (!info || !Array.isArray(info.parts) || !Number.isSafeInteger(info.size) || info.size < 0) throw new Error('Invalid media information.');
        const chunks = [];
        for (const p of info.parts) {
          const blob = await (await request('part', {id, part: String(p.number)})).blob();
          if (await hash(blob) !== p.hash) throw new Error('Media integrity check failed. No records were imported.');
          chunks.push(blob);
        }
        const blob = new Blob(chunks, {type: info.type});
        if (blob.size !== info.size) throw new Error('Incomplete media. No records were imported.');
        return blob;
      });
      if (!value || typeof value.id !== 'string') throw new Error('Invalid record ID.');
      decoded.push({store: r.store, value});
    }
    // Compare before the write transaction; never overwrite any existing record.
    const local = await readLocal(bridge), fingerprints = new Set();
    for (const r of local) fingerprints.add(r.store + ':' + await fingerprint(r.value));
    const pending = [];
    for (const r of decoded) if (!fingerprints.has(r.store + ':' + await fingerprint(r.value))) pending.push(r);
    await new Promise((resolve, reject) => {
      const tx = db.transaction([...stores, 'kv'], 'readwrite');
      const marker = tx.objectStore('kv').get('cloud-import:' + id);
      marker.onsuccess = () => {
        if (marker.result) {tx.abort(); return;}
        for (const r of pending) {
          const store = tx.objectStore(r.store), existing = store.get(r.value.id);
          existing.onsuccess = () => {
            if (existing.result) {
              r.value.id = uuid();
              if (typeof r.value.name === 'string') r.value.name += ' (cloud copy)';
              if (r.store === 'notes' && typeof r.value.text === 'string') r.value.text = '[Cloud copy]\n' + r.value.text;
            }
            store.add(r.value);
          };
        }
        tx.objectStore('kv').put(Date.now(), 'cloud-import:' + id);
        const rev=tx.objectStore('kv').get('sync-local-revision');rev.onsuccess=()=>tx.objectStore('kv').put((rev.result||0)+1,'sync-local-revision');
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Import stopped. Your existing records were preserved.'));
    });
    bridge.refresh();
    progress('Imported ' + pending.length + ' records. Existing local records were preserved. Reopen Photos, Notes, Contacts or Messages to view them.');
  }
  const auto={bridge:null,enabled:false,loaded:false,message:'Automatic sync is off.',conflicts:[],choices:{},lastRun:0};
  function syncStatus(message){auto.message=message;window.dispatchEvent(new Event('loft-sync-status'));}
  function dbRead(db,key){return new Promise((resolve,reject)=>{const r=db.transaction('kv').objectStore('kv').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function syncRead(){
    const db=await auto.bridge.openDB();if(!db)throw new Error('Local database unavailable. Sync paused.');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction([...stores,'kv'],'readonly'),records=[],state={base:{}};let revision=0;
      for(const store of stores){const r=tx.objectStore(store).getAll();r.onsuccess=()=>{for(const value of r.result)records.push({store,value});};}
      const rev=tx.objectStore('kv').get('sync-local-revision');rev.onsuccess=()=>{revision=rev.result||0;};
      const b=tx.objectStore('kv').get('sync-base-v1');b.onsuccess=()=>{state.base=b.result||{};};
      tx.oncomplete=()=>resolve({db,records,revision,base:state.base});tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not read sync state.'));
    });
  }
  async function syncMedia(entry,info){
    if(!info||!Array.isArray(info.parts)||!Number.isSafeInteger(info.size)||info.size<0)throw new Error('Invalid synced media.');
    const chunks=[];
    for(const p of info.parts){const b=await (await request('sync-part',{id:entry.source,part:String(p.number)})).blob();if(await hash(b)!==p.hash)throw new Error('Sync media integrity check failed.');chunks.push(b);}
    const b=new Blob(chunks,{type:info.type});if(b.size!==info.size)throw new Error('Incomplete synced media.');return b;
  }
  async function syncCycle(){
    const engine=window.LoftSyncEngine;if(!engine)throw new Error('Reload the app to finish the update.');
    const local=await syncRead();let entries;
    if(auto.cacheRevision===local.revision&&auto.cacheDB===local.db)entries=auto.cacheEntries;
    else{entries=[];for(const r of local.records)entries.push({store:r.store,id:r.value.id,value:r.value,deleted:false,hash:await hash(new Blob([await fingerprint(r.value)]))});auto.cacheRevision=local.revision;auto.cacheDB=local.db;auto.cacheEntries=entries;}
    const remote=await (await request('sync-index')).json();
    const plan=engine.plan(entries,remote.entries,local.base,auto.choices);
    auto.conflicts=plan.conflicts;
    if(plan.conflicts.length){
      for(const c of plan.conflicts)if(c.remote&&!c.remote.deleted)c.cloudValue=await decode(c.remote.value,async info=>({size:info.size,type:info.type}));
      syncStatus('Sync paused: '+plan.conflicts.length+' conflicting item(s). Choose which version to keep below.');return;}
    const updates=[];
    for(const e of plan.pull){
      if(e.deleted){updates.push(e);continue;}
      const value=await decode(e.value,info=>syncMedia(e,info));
      if(!value||value.id!==e.id||await hash(new Blob([await fingerprint(value)]))!==e.hash)throw new Error('Synced record integrity check failed.');
      updates.push({...e,value});
    }
    if(plan.push.length){
      const next=new Map(remote.entries.map(e=>[engine.keyOf(e),e]));
      for(const e of plan.push){
        if(e.deleted){next.set(engine.keyOf(e),{store:e.store,id:e.id,deleted:true});continue;}
        const source=uuid();let number=0;
        const value=await encode(e.value,async blob=>{
          const parts=[];
          for(let offset=0;offset<blob.size;offset+=1048576){const slice=blob.slice(offset,offset+1048576),part=number++;await request('sync-part',{id:source,part:String(part)},{data:base64(new Uint8Array(await slice.arrayBuffer()))});parts.push({number:part,hash:await hash(slice)});}
          return {size:blob.size,type:blob.type,parts};
        });
        next.set(engine.keyOf(e),{store:e.store,id:e.id,hash:e.hash,deleted:false,source,value});
      }
      await request('sync-index',{}, {revision:remote.revision,entries:[...next.values()]});
    }
    if(!auto.bridge.canSync()||!auto.enabled||!session)throw new Error('Sync will finish when you return to Home or Settings.');
    await new Promise((resolve,reject)=>{
      const tx=local.db.transaction([...stores,'kv'],'readwrite'),kv=tx.objectStore('kv'),r=kv.get('sync-local-revision');
      r.onsuccess=()=>{
        if((r.result||0)!==local.revision||!auto.bridge.canSync()||!auto.enabled||!session){tx.abort();return;}
        for(const e of updates){const store=tx.objectStore(e.store);if(e.deleted)store.delete(e.id);else store.put(e.value);}
        kv.put(plan.base,'sync-base-v1');kv.put(local.revision+(updates.length?1:0),'sync-local-revision');kv.put(Date.now(),'sync-last-success');
      };
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Local data changed during sync. It will retry.'));
    });
    auto.choices={};auto.bridge.refresh();
    let cleanupWarning='';try{const cleaned=await (await request('sync-cleanup',{},{})).json();if(!cleaned.done)cleanupWarning=' Removed media cleanup continues on the next sync.';}catch{cleanupWarning=' Removed media cleanup is pending; use Clean removed sync media.';}
    syncStatus('Up to date · '+new Date().toLocaleTimeString()+'. '+plan.push.length+' sent, '+plan.pull.length+' received.'+cleanupWarning);
  }
  async function tick(force=false){
    if(!auto.loaded||!auto.enabled||!session||busy||!auto.bridge)return;
    if(navigator.onLine===false){syncStatus('Offline. Changes stay on this device until you reconnect.');return;}
    if(!auto.bridge.canSync()){syncStatus('Changes will sync when you return to Home or Settings.');return;}
    if(document.visibilityState==='hidden'&&!force)return;
    if(!navigator.locks){syncStatus('This browser does not support safe automatic sync. Manual backups remain available.');return;}
    if(!force&&Date.now()-auto.lastRun<15000)return;
    await navigator.locks.request('loft-auto-sync-v1',{ifAvailable:true},async lock=>{
      if(!lock||busy)return;
      const db=await auto.bridge.openDB();if(!db||!await dbRead(db,'sync-enabled-v1')){auto.enabled=false;syncStatus('Automatic sync is off.');return;}
      busy=true;auto.lastRun=Date.now();
      try{syncStatus('Syncing…');await syncCycle();}
      catch(e){syncStatus('Sync paused: '+(e.message||'Connection failed. It will retry.'));}
      finally{busy=false;window.dispatchEvent(new Event('loft-sync-status'));}
    });
  }
  setInterval(()=>{tick().catch(()=>{});},15000);
  window.addEventListener('online',()=>{tick(true).catch(()=>{});});
  document.addEventListener('visibilitychange',()=>{tick().catch(()=>{});});
  async function setAuto(enabled){
    const db=await auto.bridge.openDB();if(!db)throw new Error('Local storage unavailable.');
    await new Promise((resolve,reject)=>{const tx=db.transaction('kv','readwrite');tx.objectStore('kv').put(enabled,'sync-enabled-v1');const rev=tx.objectStore('kv').get('sync-local-revision');rev.onsuccess=()=>tx.objectStore('kv').put((rev.result||0)+1,'sync-local-revision');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    auto.enabled=enabled;syncStatus(enabled?'Automatic sync enabled. Preparing first sync…':'Automatic sync is off.');
    setTimeout(()=>{tick(true).catch(()=>{});},0);
  }
  function mount(root, bridge) {
    auto.bridge=bridge;
    const section = node('section'); section.className = 'cloud-panel';
    section.style.cssText = 'margin:16px;padding:18px;border:1px solid #8886;border-radius:16px;line-height:1.5;color:var(--ink,#111);background:var(--card,#fff)';
    section.append(node('h2', 'Cloud Storage'), node('p', 'Automatic sync shares your current data between enabled devices. Dated snapshots remain separate backups. Your local privacy lock stays separate.'));
    const status = node('p', session ? 'Signed in for this page session.' : 'Sign in with your app email and password.'); status.setAttribute('role', 'status'); status.style.overflowWrap = 'anywhere';
    const form = node('form'), email = node('input'), password = node('input'), signin = node('button', 'Sign in');
    email.type = 'email'; email.placeholder = 'Email address'; email.autocomplete = 'username'; email.required = true; email.setAttribute('aria-label', 'Email address');
    password.type = 'password'; password.placeholder = 'App cloud password'; password.autocomplete = 'current-password'; password.required = true; password.setAttribute('aria-label', 'App cloud password');
    signin.type = 'submit';
    form.append(email, password, signin);
    const actions = node('div'), upload = node('button', 'Save snapshot'), list = node('button', 'Show saved snapshots'), logout = node('button', 'Sign out'), snapshots = node('div');
    actions.append(upload, list, logout); section.append(form, actions, status, snapshots); root.append(section);
    for (const x of section.querySelectorAll('input,button')) x.style.cssText = 'font:inherit;padding:10px;margin:4px 0;width:100%;border:1px solid #8888;border-radius:8px;background:var(--card,#fff);color:var(--ink,#111)';
    function display() {form.hidden = !!session; actions.hidden = !session;}
    function progress(text) {status.textContent = text;}
    async function run(fn) {
      if (busy) return;
      busy = true; section.querySelectorAll('button').forEach(b => {b.disabled = true;});
      try {await fn();} catch(e) {progress(e.message || 'Operation failed. Try again.');}
      finally {busy = false; section.querySelectorAll('button').forEach(b => {b.disabled = false;}); display();}
    }
    form.onsubmit = e => {e.preventDefault(); run(async () => {
      progress('Signing in…');
      try {session = await auth('password', {email: email.value.trim(), password: password.value}); await request('session');}
      catch (e) {session = null; throw e;} finally {password.value = '';}
      progress('Signed in. You can now save or import snapshots.');
      setTimeout(()=>{tick(true).catch(()=>{});},0);
    });};
    upload.onclick = () => run(() => save(bridge, progress));
    let cursor;
    const objectURLs = new Set();
    function clearPreviews(){for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();}
    function button(text,fn,parent){const b=node('button',text);b.type='button';b.style.cssText='display:block;padding:12px;margin:8px 0;font:inherit;width:100%;border:1px solid #8888;border-radius:8px;background:var(--card,#fff);color:var(--ink,#111)';b.onclick=()=>run(fn);parent.append(b);return b;}
    async function cleanup(id){
      let next;
      do {const r=await (await request('cleanup',{id},next?{cursor:next}:{})).json();next=r.cursor;}while(next);
    }
    async function mediaBlob(id,info){
      const chunks=[];
      if(!info||!Array.isArray(info.parts)||!Number.isSafeInteger(info.size)||info.size<0)throw new Error('Invalid media information.');
      for(const p of info.parts){const b=await (await request('part',{id,part:String(p.number)})).blob();if(await hash(b)!==p.hash)throw new Error('Media integrity check failed.');chunks.push(b);}
      const b=new Blob(chunks,{type:info.type});if(b.size!==info.size)throw new Error('Incomplete media.');return b;
    }
    async function browse(item){
      clearPreviews(); snapshots.textContent='';
      const data=await (await (item.sync?request('sync-index'):request('browse',{id:item.id}))).json();
      const active=item.sync?data.entries.filter(e=>!e.deleted):null;
      const manifest=item.sync?{records:active.map(e=>({store:e.store,value:e.value})),createdAt:Date.now()}:data.manifest,revision=data.revision;
      snapshots.append(node('h3',item.sync?'Current synced collection':'Backup · '+new Date(manifest.createdAt||item.savedAt).toLocaleString()));
      button('Back to saved snapshots',reload,snapshots);
      if(manifest.deleting){snapshots.append(node('p','Deletion was started for this backup. Resume to finish removing its files.'));button('Resume deleting backup',()=>deleteBackup(item),snapshots);return;}
      snapshots.append(node('p',manifest.records.length+(item.sync?' synced items. Deletions here apply to enabled devices on their next sync. Older snapshots remain unchanged.':' items. Browsing does not import anything. Deleting here affects only this backup. Copies on devices and in other backups remain.')));
      const filter=node('select');filter.setAttribute('aria-label','Filter cloud items');filter.style.cssText='font:inherit;padding:10px;width:100%;background:var(--card,#fff);color:var(--ink,#111)';
      for(const [value,label] of [['all','All items'],['media','Photos and videos'],['notes','Notes'],['contacts','Contacts'],['chats','Conversations']]){const o=node('option',label);o.value=value;filter.append(o);}
      snapshots.append(filter);
      const items=node('div');snapshots.append(items);let shown=0,selected=[];
      const decoded=[];
      for(let index=0;index<manifest.records.length;index++){
        const r=manifest.records[index];
        decoded.push({index,store:r.store,value:await decode(r.value,async info=>({cloudMedia:info}))});
      }
      async function page(){
        const end=Math.min(shown+25,selected.length);
        for(;shown<end;shown++){
          const {index,store,value}=selected[shown], card=node('article');card.style.cssText='border:1px solid #8886;border-radius:12px;padding:12px;margin:12px 0;overflow-wrap:anywhere';
          card.append(node('h4',value.name||value.title||(store==='notes'?String(value.text||'Untitled note').slice(0,80):store+' item')));
          card.append(node('small',({media:'Photo / video',notes:'Note',contacts:'Contact',chats:'Conversation'})[store]||store));
          if(store==='media'){
            const info=value.blob&&value.blob.cloudMedia;
            card.append(node('p',info?(info.size/1048576).toFixed(2)+' MB':'No media file'));
            if(info)button('View photo / play video',async()=>{
              progress('Loading selected media…');const blob=await (item.sync?syncMedia(active[index],info):mediaBlob(item.id,info));
              const type=blob.type.startsWith('video/')?'video':blob.type.startsWith('image/')?'img':null;
              if(!type)throw new Error('This media type cannot be previewed.');
              const old=card.querySelector('img,video');if(old){URL.revokeObjectURL(old.src);objectURLs.delete(old.src);old.remove();}
              const view=node(type),url=URL.createObjectURL(blob);objectURLs.add(url);view.src=url;view.style.cssText='display:block;max-width:100%;max-height:420px;margin:12px auto';
              if(type==='video'){view.controls=true;view.preload='metadata';}else view.alt=value.name||'Cloud photo';
              card.append(view);progress('Viewing cloud media. Nothing was imported.');
            },card);
          }else{
            const text=node('pre');text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:320px;overflow:auto';
            text.textContent=store==='notes'?String(value.text||''):store==='contacts'?[value.name,value.number].filter(Boolean).join('\n'):(value.messages||[]).map(m=>(m.me?'You':value.name||'Contact')+' · '+new Date(m.ts).toLocaleString()+'\n'+String(m.text||'')).join('\n\n');
            card.append(text);
          }
          button(item.sync?'Delete from synced collection':'Delete item from this backup',async()=>{
            if(item.sync){
              if(!confirm('Delete this item from the shared collection and enabled devices on their next sync? Offline edits may need conflict resolution. Older backups remain unchanged.'))return;
              const selected=active[index];await request('sync-index',{}, {revision,entries:data.entries.map(e=>e.store===selected.store&&e.id===selected.id?{store:e.store,id:e.id,deleted:true}:e)});
              await browse(item);progress('Deleted from the synced collection. Enabled devices receive this deletion on their next sync.');setTimeout(()=>{tick(true).catch(()=>{});},0);return;
            }
            if(!confirm('Permanently delete this item from THIS backup? Other backups and local device copies remain. A future save can upload the local copy again.'))return;
            await request('remove-record',{id:item.id},{revision,index});
            let warning='';try{progress('Removing unused media files…');await cleanup(item.id);}catch{warning=' The item was removed, but unused media cleanup is unfinished. Use Clean unused media to retry.';}
            await browse(item);progress('Item deleted from this backup. Local copies and other backups remain.'+warning);
          },card);
          items.append(card);
        }
        if(shown<selected.length){const more=button('Show more items',async()=>{more.remove();await page();},items);}
      }
      async function applyFilter(){clearPreviews();items.textContent='';shown=0;selected=decoded.filter(x=>filter.value==='all'||x.store===filter.value);if(!selected.length)items.append(node('p','No items in this category.'));await page();}
      filter.onchange=()=>run(applyFilter);await applyFilter();
      if(!item.sync)button('Clean unused media',async()=>{await cleanup(item.id);progress('Unused media removed from this backup.');},snapshots);
      if(!item.sync)button('Delete entire backup',()=>deleteBackup(item),snapshots);
      progress('Browsing '+manifest.records.length+' cloud items. No local data changed.');
    }
    async function deleteBackup(item){
      if(!confirm('Permanently delete this ENTIRE cloud backup and its media? Local device copies and other backups remain. This cannot be undone.'))return;
      const {revision}=await (await request('browse',{id:item.id})).json();
      let done=false;
      while(!done){progress('Deleting backup files… Keep this page open. If interrupted, use Delete entire backup again to resume.');done=(await (await request('delete-snapshot',{id:item.id},{revision})).json()).done;}
      await reload();progress('Cloud backup deleted. Local copies and other backups remain.');
    }
    async function loadPage(){
      const data=await (await request('list',cursor?{cursor}:{})).json();
      for(const item of data.items.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)))){
        const card=node('article');card.style.cssText='border:1px solid #8886;border-radius:12px;padding:12px;margin:12px 0';
        card.append(node('h3','Backup · last saved or changed '+new Date(item.savedAt).toLocaleString()));
        button('Browse contents',()=>browse(item),card);
        button('Import snapshot',async()=>{if(confirm('Import this snapshot? Existing local data stays. Differing records are added as separate copies. Deletions are not applied.'))await importSnapshot(bridge,item.id,progress);},card);
        button('Delete entire backup',()=>deleteBackup(item),card);snapshots.append(card);
      }
      cursor=data.cursor;
      if(cursor){const more=button('Load more snapshots',async()=>{more.remove();await loadPage();},snapshots);}
      progress(snapshots.childElementCount?'Choose a snapshot to browse, import or delete.':'No saved snapshots yet.');
    }
    async function reload(){clearPreviews();snapshots.textContent='';cursor=null;await loadPage();}
    list.onclick=()=>run(reload);
    logout.onclick = () => run(async () => {
      const old = session; session = null; clearPreviews(); snapshots.textContent = '';
      if (old) {const c = await getConfig(); await fetch(c.url + '/auth/v1/logout?scope=local', {method:'POST', headers:{apikey:c.publishableKey,Authorization:'Bearer '+old.access_token}}).catch(() => {});}
      progress('Signed out on this page. Local records are still available behind your local privacy lock.');
    });
    const syncPanel=node('div');syncPanel.style.cssText='border:1px solid #8886;border-radius:12px;padding:12px;margin:16px 0';
    const syncText=node('p'),conflictList=node('div');syncText.setAttribute('role','status');
    syncPanel.append(node('h3','Automatic sync'),node('p','Sync runs while this page is open and signed in, when you are on Home or Settings. Enable it on each device. Offline changes are kept until you reconnect. Deletions sync too; older backups are unchanged.'),syncText);
    const toggle=button('Enable automatic sync',async()=>{
      if(!auto.enabled&&!confirm('Enable automatic sync on this device? Current photos, videos, notes, contacts and conversations will merge with your shared collection. Future edits and deletions sync between enabled devices. Conflicting edits pause for your choice. Dated backups stay separate.'))return;
      await setAuto(!auto.enabled);
    },syncPanel);
    button('Sync now',async()=>{setTimeout(()=>{tick(true).catch(()=>{});},0);},syncPanel);
    button('Browse synced collection',()=>browse({sync:true}),syncPanel);
    button('Clean removed sync media',async()=>{let done=false;while(!done){progress('Removing unused sync media… Keep this page open.');done=(await (await request('sync-cleanup',{},{})).json()).done;}progress('Removed sync media cleanup is complete. Older backups remain unchanged.');},syncPanel);
    syncPanel.append(conflictList);actions.prepend(syncPanel);
    function renderSync(){
      syncText.textContent=auto.message;toggle.textContent=auto.enabled?'Pause automatic sync':'Enable automatic sync';
      syncPanel.querySelectorAll('button').forEach(b=>{b.disabled=busy;});conflictList.textContent='';
      for(const conflict of auto.conflicts){
        const box=node('div'),e=conflict.local||conflict.remote;box.append(node('h4','Conflicting '+e.store+' item'));
        const localValue=conflict.local&&!conflict.local.deleted?conflict.local.value:null;
        box.append(node('p','This device: '+(localValue?(localValue.name||String(localValue.text||e.id).slice(0,100)):'deleted')));
        const cloudValue=conflict.cloudValue;
        box.append(node('p','Cloud: '+(cloudValue?(cloudValue.name||String(cloudValue.text||e.id).slice(0,100)):'deleted')));
        if(e.store==='notes'){
          for(const [label,value] of [['This device',localValue],['Cloud',cloudValue]]){const detail=node('details');detail.append(node('summary',label+' full note'));const text=node('pre',value?String(value.text||''):'Deleted');text.style.cssText='white-space:pre-wrap;max-height:240px;overflow:auto;font:inherit';detail.append(text);box.append(detail);}
        }else box.append(node('p','Use Browse synced collection to inspect the cloud item, and the app to inspect this device’s copy before choosing.'));

        for(const [direction,label] of [['push','Keep this device’s version'],['pull','Keep cloud version']])button(label,async()=>{
          if(!confirm(label+' for this item? This choice replaces the other version in the shared collection or on this device. Older snapshots remain available.'))return;
          auto.choices[conflict.key]={direction,local:conflict.localStamp,remote:conflict.remoteStamp};
          auto.conflicts=auto.conflicts.filter(c=>c.key!==conflict.key);renderSync();setTimeout(()=>{tick(true).catch(()=>{});},0);
        },box);
        conflictList.append(box);
      }
    }
    const listener=()=>{if(section.isConnected)renderSync();else window.removeEventListener('loft-sync-status',listener);};window.addEventListener('loft-sync-status',listener);
    bridge.openDB().then(async db=>{auto.enabled=!!(db&&await dbRead(db,'sync-enabled-v1'));auto.loaded=true;syncStatus(auto.enabled?'Automatic sync enabled. Sign in to resume.':'Automatic sync is off.');await tick(true);}).catch(e=>syncStatus(e.message));
    renderSync();
    display();
  }
  window.LoftCloud = {mount};
  if (typeof module !== 'undefined') module.exports = {encode, decode};
})();
