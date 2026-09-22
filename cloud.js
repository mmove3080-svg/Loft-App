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
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Import stopped. Your existing records were preserved.'));
    });
    bridge.refresh();
    progress('Imported ' + pending.length + ' records. Existing local records were preserved. Reopen Photos, Notes, Contacts or Messages to view them.');
  }
  function mount(root, bridge) {
    const section = node('section'); section.className = 'cloud-panel';
    section.style.cssText = 'margin:16px;padding:18px;border:1px solid #8886;border-radius:16px;line-height:1.5;color:var(--ink,#111);background:var(--card,#fff)';
    section.append(node('h2', 'Cloud Storage'), node('p', 'Save a private snapshot, then import it on another device. Sync is manual. Your local privacy lock stays separate.'));
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
      const {manifest,revision}=await (await request('browse',{id:item.id})).json();
      snapshots.append(node('h3','Backup · '+new Date(manifest.createdAt||item.savedAt).toLocaleString()));
      button('Back to saved snapshots',reload,snapshots);
      if(manifest.deleting){snapshots.append(node('p','Deletion was started for this backup. Resume to finish removing its files.'));button('Resume deleting backup',()=>deleteBackup(item),snapshots);return;}
      snapshots.append(node('p',manifest.records.length+' items. Browsing does not import anything. Deleting here affects only this backup. Copies on devices and in other backups remain.'));
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
              progress('Loading selected media…');const blob=await mediaBlob(item.id,info);
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
          button('Delete item from this backup',async()=>{
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
      button('Clean unused media',async()=>{await cleanup(item.id);progress('Unused media removed from this backup.');},snapshots);
      button('Delete entire backup',()=>deleteBackup(item),snapshots);
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
    display();
  }
  window.LoftCloud = {mount};
  if (typeof module !== 'undefined') module.exports = {encode, decode};
})();
