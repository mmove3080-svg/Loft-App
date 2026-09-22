/* Private cloud snapshots. Loaded only as public application code; credentials stay on the server. */
(function () {
  'use strict';
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
    section.style.cssText = 'margin:16px;padding:18px;border:1px solid #8886;border-radius:16px;line-height:1.5';
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
    async function loadPage() {
      const data = await (await request('list', cursor ? {cursor} : {})).json();
      for (const item of data.items.sort((a,b) => String(b.savedAt).localeCompare(String(a.savedAt)))) {
        const b = node('button', 'Import snapshot · ' + new Date(item.savedAt).toLocaleString());
        b.style.cssText = 'display:block;padding:12px;margin:8px 0;font:inherit;width:100%';
        b.onclick = () => run(async () => {
          if (!confirm('Import this snapshot? Existing local data stays. Differing records are added as separate copies. Deletions are not applied.')) return;
          await importSnapshot(bridge, item.id, progress);
        }); snapshots.append(b);
      }
      cursor = data.cursor;
      if (cursor) {const more = node('button', 'Load more snapshots'); more.onclick = () => run(async () => {more.remove(); await loadPage();}); snapshots.append(more);}
      progress(snapshots.childElementCount ? 'Choose a snapshot to import. Imports preserve existing records.' : 'No saved snapshots yet.');
    }
    list.onclick = () => run(async () => {snapshots.textContent = ''; cursor = null; await loadPage();});
    logout.onclick = () => run(async () => {
      const old = session; session = null; snapshots.textContent = '';
      if (old) {const c = await getConfig(); await fetch(c.url + '/auth/v1/logout?scope=local', {method:'POST', headers:{apikey:c.publishableKey,Authorization:'Bearer '+old.access_token}}).catch(() => {});}
      progress('Signed out on this page. Local records are still available behind your local privacy lock.');
    });
    display();
  }
  window.LoftCloud = {mount};
  if (typeof module !== 'undefined') module.exports = {encode, decode};
})();
