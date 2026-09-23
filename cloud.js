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
    section.append(node('h2', bridge.library?'Cloud Library':'Cloud Storage'), node('p', 'Automatic sync shares your current data between enabled devices. Dated snapshots remain separate backups. Your local privacy lock stays separate.'));
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
      progress('Signed in. Your cloud library is ready.');
      syncStatus(auto.enabled?'Automatic sync enabled.':'Automatic sync is off.');
      if(bridge.library)await browse({sync:true});
      setTimeout(()=>{tick(true).catch(()=>{});},0);
    });};
    upload.onclick = () => run(() => save(bridge, progress));
    let cursor;
    const objectURLs = new Set();
    function clearPreviews(){for(const dialog of document.querySelectorAll('dialog[data-loft-preview]')){if(dialog.close)dialog.close();else dialog.remove();}for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs.clear();}
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
    const bytesLabel=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':n<1073741824?(n/1048576).toFixed(1)+' MB':(n/1073741824).toFixed(2)+' GB';
    function download(blob,name){
      const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=String(name||'download').replace(/[\\/\x00-\x1f]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }
    function recordText(store,value){
      return store==='notes'?String(value.text||''):store==='contacts'?[value.name,value.number].filter(Boolean).join('\n'):(value.messages||[]).map(m=>(m.me?'You':value.name||'Contact')+' · '+new Date(m.ts).toLocaleString()+'\n'+String(m.text||'')).join('\n\n');
    }
    function viewer(blob,name){
      const dialog=node('dialog');dialog.dataset.loftPreview='true';dialog.className='loft-viewer';
      const close=node('button','Close preview');close.type='button';close.onclick=()=>dialog.close();
      const title=node('h3',name||'Media preview');dialog.append(close,title);
      const media=node(blob.type.startsWith('video/')?'video':'img'),url=URL.createObjectURL(blob);media.src=url;
      if(media.tagName==='VIDEO'){media.controls=true;media.preload='metadata';}else media.alt=name||'Cloud image';
      dialog.append(media);document.body.append(dialog);
      dialog.addEventListener('close',()=>{if(media.pause)media.pause();URL.revokeObjectURL(url);dialog.remove();},{once:true});
      if(dialog.showModal)dialog.showModal();else{dialog.setAttribute('open','');close.onclick=()=>{URL.revokeObjectURL(url);dialog.remove();};}
    }
    async function storageOverview(){
      libraryView++;
      clearPreviews();snapshots.textContent='';snapshots.append(node('h3','Storage overview'));
      const summary=node('p','Calculating your cloud storage…');snapshots.append(summary);
      const total={sync:0,backups:0,other:0,objects:0};let next;
      do{const r=await(await request('storage-usage',next?{cursor:next}:{})).json();for(const k in total)total[k]+=r.totals[k];next=r.cursor;summary.textContent='Counted '+total.objects+' files…';}while(next);
      summary.textContent='Your app uses '+bytesLabel(total.sync+total.backups+total.other)+' in cloud storage.';
      const grid=node('div');grid.className='library-stats';
      for(const [label,n] of [['Synced data and Trash',total.sync],['Saved backups',total.backups],['Other app files',total.other]]){const card=node('article');card.append(node('strong',bytesLabel(n)),node('p',label));grid.append(card);}snapshots.append(grid);
      snapshots.append(node('p','Includes stored metadata, thumbnails and media awaiting cleanup. This is your app’s usage, not a Cloudflare billing estimate. A changing collection can affect the count.'));
      if(navigator.storage&&navigator.storage.estimate){const local=await navigator.storage.estimate();snapshots.append(node('p','This browser uses about '+bytesLabel(local.usage||0)+' of '+bytesLabel(local.quota||0)+' available to this site. This includes offline records and app files.'));}
      progress('Storage overview updated.');
    }
    let libraryView=0;
    async function browse(item){
      const viewId=++libraryView;
      clearPreviews();snapshots.textContent='';progress('Loading library…');
      const data=await(await(item.sync?request('sync-index'):request('browse',{id:item.id}))).json();
      const active=item.sync?(item.trash?data.trash||[]:data.entries.filter(e=>!e.deleted)):null;
      const manifest=item.sync?{records:active.map(e=>({store:e.store,value:e.value})),createdAt:Date.now()}:data.manifest,revision=data.revision;
      snapshots.append(node('h3',item.trash?'Trash · 30-day recovery':item.sync?'Your cloud collection':'Saved backup · '+new Date(manifest.createdAt||item.savedAt).toLocaleString()));
      if(manifest.deleting){snapshots.append(node('p','This backup is being deleted.'));button('Resume deleting backup',()=>deleteBackup(item),snapshots);return;}
      snapshots.append(node('p',item.trash?'Restore items before their recovery deadline. Expired items are removed during scheduled cleanup. Older backups are separate.':item.sync?'Search and browse your synced photos, videos, notes, contacts and conversations. Deleted synced items go to Trash.':'Browsing does not import anything. Backup deletions are permanent and affect this backup only.'));
      const toolbar=node('div');toolbar.className='library-toolbar';
      const search=node('input');search.type='search';search.placeholder='Search names, notes, numbers and messages';search.setAttribute('aria-label','Search cloud library');
      const filter=node('select');filter.setAttribute('aria-label','Filter cloud items');
      for(const [value,label] of [['all','All items'],['media','Photos and videos'],['notes','Notes'],['contacts','Contacts'],['chats','Conversations']]){const o=node('option',label);o.value=value;filter.append(o);}
      const sort=node('select');sort.setAttribute('aria-label','Sort cloud items');for(const [v,label] of [['new','Newest first'],['name','Name A–Z']]){const o=node('option',label);o.value=v;sort.append(o);}toolbar.append(search,filter,sort);snapshots.append(toolbar);
      const count=node('p'),items=node('div');items.className='library-grid';snapshots.append(count,items);let shown=0,selected=[];
      const decoded=[];
      for(let index=0;index<manifest.records.length;index++){
        const r=manifest.records[index],value=await decode(r.value,async info=>({cloudMedia:info}));
        decoded.push({index,store:r.store,value,name:value.name||value.title||(r.store==='notes'?String(value.text||'Untitled note').slice(0,80):r.store+' item'),search:JSON.stringify(value).toLowerCase()});
      }
      async function getBlob(index,info){return item.sync?syncMedia(active[index],info):mediaBlob(item.id,info);}
      async function exportRecord(r){
        const value=await decode(manifest.records[r.index].value,async info=>({type:info.type,size:info.size,data:base64(new Uint8Array(await(await getBlob(r.index,info)).arrayBuffer()))}));
        download(new Blob([JSON.stringify({format:'loft-portable-record-v1',store:r.store,value},null,2)],{type:'application/json'}),r.name+'.json');
      }
      button('Export matching records',async()=>{
        if(!selected.length){progress('No matching records to export.');return;}
        // Structured text export stays small. Original media downloads are explicit per item.
        const out=selected.map(r=>({store:r.store,value:r.value}));
        download(new Blob([JSON.stringify({format:'loft-library-text-export-v1',exportedAt:new Date().toISOString(),note:'Media entries contain metadata only. Download originals using each media card.',records:out},null,2)],{type:'application/json'}),'loft-library-export.json');
        progress('Exported matching text records and media metadata. Use Download original for media files.');
      },snapshots);
      async function page(){
        if(viewId!==libraryView||!section.isConnected)return;
        const end=Math.min(shown+24,selected.length);
        for(;shown<end;shown++){
          const r=selected[shown],{index,store,value}=r,card=node('article');card.className='library-card';
          card.append(node('small',({media:'Photo / video',notes:'Note',contacts:'Contact',chats:'Conversation'})[store]),node('h4',r.name));
          if(store==='media'){
            const info=value.blob&&value.blob.cloudMedia,thumb=value.thumb&&value.thumb.cloudMedia;
            card.append(node('p',info?bytesLabel(info.size):'No media file'));
            const holder=node('div');holder.className='library-thumb';holder.textContent=info&&info.type.startsWith('video/')?'Video':'Photo';card.append(holder);
            if(thumb){try{const blob=await getBlob(index,thumb);if(blob.type.startsWith('image/')){const image=node('img'),url=URL.createObjectURL(blob);objectURLs.add(url);image.src=url;image.alt=r.name;image.loading='lazy';holder.textContent='';holder.append(image);}}catch{holder.textContent='Preview unavailable · open original';}}
            else if(typeof value.thumb==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(value.thumb)){const image=node('img');image.src=value.thumb;image.alt=r.name;image.loading='lazy';holder.textContent='';holder.append(image);}
            if(info){
              button('View photo / play video',async()=>{progress('Loading media…');const blob=await getBlob(index,info);if(!/^(image|video)\//.test(blob.type))throw new Error('Download this file to view it.');viewer(blob,r.name);progress('Preview open. Nothing was imported.');},card);
              button('Download original',async()=>{progress('Preparing download…');download(await getBlob(index,info),value.name||'media');progress('Original media downloaded.');},card);
            }
          }else{
            const text=node('pre',recordText(store,value));text.className='library-text';card.append(text);
            button('Download text',async()=>download(new Blob([recordText(store,value)],{type:'text/plain;charset=utf-8'}),r.name+'.txt'),card);
            button('Export record as JSON',()=>exportRecord(r),card);
          }
          if(item.trash){
            const entry=active[index],remaining=Math.max(0,Math.ceil((entry.expiresAt-(data.serverTime||Date.now()))/86400000));
            card.append(node('p',remaining?'Recoverable for '+remaining+' more day'+(remaining===1?'':'s')+' · until '+new Date(entry.expiresAt).toLocaleString():'Recovery expired · awaiting cleanup'));
            if(remaining)button('Restore item',async()=>{await request('trash-restore',{}, {revision,store:entry.store,id:entry.id});await browse(item);progress('Restored to your cloud collection. Enabled devices receive it on their next sync.');setTimeout(()=>tick(true).catch(()=>{}),0);},card);
            button('Delete permanently',async()=>{if(!confirm('Permanently remove this item from Trash now? Older backups may still hold separate copies.'))return;await request('trash-purge',{}, {revision,store:entry.store,id:entry.id});await request('sync-cleanup',{},{}).catch(()=>{});await browse(item);progress('Removed from Trash. Remaining media cleanup will resume automatically.');},card);
          }else button(item.sync?'Move to Trash':'Delete item from this backup',async()=>{
            if(item.sync){
              if(!confirm('Move this item to Trash? Enabled devices receive the deletion on their next sync. You can restore it for 30 days.'))return;
              const entry=active[index];await request('sync-index',{}, {revision,entries:data.entries.map(e=>e.store===entry.store&&e.id===entry.id?{store:e.store,id:e.id,deleted:true}:e)});
              await browse(item);progress('Moved to Trash for 30 days.');setTimeout(()=>tick(true).catch(()=>{}),0);return;
            }
            if(!confirm('Permanently delete this item from THIS backup? Other backups and device copies remain.'))return;
            await request('remove-record',{id:item.id},{revision,index});let warning='';try{await cleanup(item.id);}catch{warning=' Use Clean unused media to finish cleanup.';}await browse(item);progress('Deleted from this backup.'+warning);
          },card);
          if(viewId!==libraryView||!section.isConnected)return;
          items.append(card);
        }
        if(shown<selected.length){const more=button('Show more items',async()=>{more.remove();await page();},items);}
      }
      async function applyFilter(){
        clearPreviews();items.textContent='';shown=0;const query=search.value.trim().toLowerCase();
        selected=decoded.filter(x=>(filter.value==='all'||x.store===filter.value)&&(!query||x.search.includes(query)));
        selected.sort((a,b)=>sort.value==='name'?a.name.localeCompare(b.name):Number(b.value.updatedAt||b.value.createdAt||0)-Number(a.value.updatedAt||a.value.createdAt||0));
        count.textContent=selected.length+' of '+decoded.length+' items';if(!selected.length)items.append(node('p',item.trash?'Trash is empty or no items match your search.':'No matching items. Try another search or filter.'));await page();
      }
      // Coalesce typing while a media thumbnail is loading, without overlapping renders.
      let rendering=false,pending=false;
      async function refreshFilter(){pending=true;if(rendering)return;rendering=true;try{while(pending){pending=false;await applyFilter();}}catch(e){progress(e.message);}finally{rendering=false;}}
      search.oninput=refreshFilter;filter.onchange=refreshFilter;sort.onchange=refreshFilter;await refreshFilter();
      if(!item.sync){button('Clean unused media',async()=>{await cleanup(item.id);progress('Unused backup media removed.');},snapshots);button('Delete entire backup',()=>deleteBackup(item),snapshots);}
      progress('Browsing '+manifest.records.length+' items. No local data changed.');
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
    async function reload(){libraryView++;clearPreviews();snapshots.textContent='';cursor=null;await loadPage();}
    list.onclick=()=>run(reload);
    logout.onclick = () => run(async () => {
      const old = session; session = null; libraryView++; clearPreviews(); snapshots.textContent = '';
      if (old) {const c = await getConfig(); await fetch(c.url + '/auth/v1/logout?scope=local', {method:'POST', headers:{apikey:c.publishableKey,Authorization:'Bearer '+old.access_token}}).catch(() => {});}
      syncStatus('Sign in to resume cloud sync.');
      progress('Signed out on this page. Local records are still available behind your local privacy lock.');
    });
    const tabs=node('nav');tabs.className='library-tabs';tabs.setAttribute('aria-label','Cloud Library sections');
    button('Collection',()=>browse({sync:true}),tabs);
    button('Trash',()=>browse({sync:true,trash:true}),tabs);
    button('Backups',reload,tabs);
    button('Storage',storageOverview,tabs);
    actions.prepend(tabs);
    const syncPanel=node('div');syncPanel.style.cssText='border:1px solid #8886;border-radius:12px;padding:12px;margin:16px 0';
    const syncText=node('p'),conflictList=node('div');syncText.setAttribute('role','status');
    syncPanel.append(node('h3','Automatic sync'),node('p','Sync runs while this page is open and signed in, when you are on Home, Cloud Library or Settings. Enable it on each device. Offline changes are kept until you reconnect. Deletions sync too; older backups are unchanged.'),syncText);
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
    const observer=new MutationObserver(()=>{if(!section.isConnected){libraryView++;clearPreviews();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
    renderSync();
    display();
    if(bridge.library&&session)run(()=>browse({sync:true}));
  }
  window.LoftCloud = {mount, status:()=>({signedIn:!!session,enabled:auto.enabled,message:auto.message}),
    attachHome(element){
      const render=()=>{element.textContent=!session?'Cloud · Sign in to sync':!navigator.onLine?'Cloud · Offline — changes stay on this device':auto.enabled?'Cloud · '+auto.message:'Cloud · Automatic sync paused';};
      window.addEventListener('loft-sync-status',render);window.addEventListener('online',render);window.addEventListener('offline',render);render();
    }};
  if (typeof module !== 'undefined') module.exports = {encode, decode};
})();
