(function(global){
'use strict';
const n=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
const b=(text,fn,cls)=>{const e=n('button',cls,text);e.onclick=fn;return e;};
function mount(api,DB){
 const root=api.root;let notes=[],query='',mode='all',editor=null,flush=null,timer=null,dead=false,limit=80,canLeave=null;
 const nav=n('header','photo-nav');nav.append(n('h1',null,'Notes'),b('New note',create,'accent'));root.append(nav);
 const tools=n('div','photo-tools'),search=n('input');search.type='search';search.placeholder='Search notes';search.setAttribute('aria-label','Search notes');const filter=n('select');filter.setAttribute('aria-label','Note category');[['all','All notes'],['pinned','Pinned'],['archived','Archived']].forEach(([v,t])=>{const o=n('option',null,t);o.value=v;filter.append(o);});tools.append(search,filter);root.append(tools);
 const list=n('div','scroll note-list');root.append(list);
 function title(r){return r.text.trim().split('\n')[0]||'Untitled note';}
 function draw(){if(dead)return;list.textContent='';const q=query.toLowerCase();const visible=notes.filter(r=>(mode==='archived'?r.archived:!r.archived)&&(mode!=='pinned'||r.pinned)&&(!q||r.text.toLowerCase().includes(q))).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||b.updatedAt-a.updatedAt);
  if(!visible.length){const e=n('div','photo-empty');e.append(n('h2',null,q?'No matching notes':'Room for your next idea'),n('p',null,q?'Try another word.':'Write a note, make a checklist, or save a thought.'),b('New note',create));list.append(e);}
  visible.slice(0,limit).forEach(r=>{const row=b('',()=>edit(r),'note-card');row.append(n('h2',null,(r.pinned?'⌁ ':'')+title(r)),n('p',null,r.text.split('\n').slice(1).join(' ').slice(0,160)||'No additional text'),n('time',null,new Date(r.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})));list.append(row);});
  if(visible.length>limit)list.append(b('Show more notes',()=>{limit+=80;draw();},'load-more'));
 }
 let searchTimer;search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=search.value;limit=80;draw();},120);};filter.onchange=()=>{mode=filter.value;limit=80;draw();};
 function create(){const r={id:crypto.randomUUID(),text:'',createdAt:Date.now(),updatedAt:Date.now()};notes.unshift(r);edit(r,true);}
 function edit(r,isNew){
  let dirty=isNew,deleted=false,version=0,savedVersion=-1,chain=Promise.resolve();
  editor=n('section','note-editor');const enav=n('header','photo-nav'),back=b('Notes',close),state=n('span','save-status','Saved'),more=b('Delete',remove,'danger');enav.append(back,state,more);
  const formatting=n('div','note-format');const ta=n('textarea');ta.setAttribute('aria-label','Note text');ta.placeholder='Title\nStart writing…';ta.value=r.text;ta.spellcheck=true;
  const pin=b(r.pinned?'Unpin':'Pin',()=>{r.pinned=!r.pinned;pin.textContent=r.pinned?'Unpin':'Pin';change();});
  const archive=b(r.archived?'Unarchive':'Archive',async()=>{r.archived=!r.archived;change();await close();});
  function insert(before,after){const start=ta.selectionStart,end=ta.selectionEnd;ta.setRangeText(before+ta.value.slice(start,end)+(after||''),start,end,'end');change();ta.focus();}
  formatting.append(b('Heading',()=>insert('\n# ')),b('Bold',()=>insert('**','**')),b('Checklist',()=>insert('\n- [ ] ')),b('Check / uncheck',()=>{const at=ta.selectionStart,start=ta.value.lastIndexOf('\n',at-1)+1,end=ta.value.indexOf('\n',at),line=ta.value.slice(start,end<0?ta.value.length:end);if(/^- \[[ x]\] /.test(line)){ta.setRangeText(line.replace(/^- \[([ x])\]/,(_,x)=>x==='x'?'- [ ]':'- [x]'),start,start+line.length,'end');change();}else insert('- [ ] ');ta.focus();}),pin,archive);
  const help=n('div','note-help','Plain-text formatting: # heading, **bold**, - [ ] checklist. Your text stays portable.');
  const preview=n('div','note-preview');preview.hidden=true;
  function renderPreview(){preview.textContent='';ta.value.split('\n').forEach((line,i)=>{const checklist=/^- \[([ x])\] (.*)/.exec(line);if(checklist){const label=n('label','checklist-row'),check=n('input');check.type='checkbox';check.checked=checklist[1]==='x';check.onchange=()=>{const lines=ta.value.split('\n');lines[i]='- ['+(check.checked?'x':' ')+'] '+checklist[2];ta.value=lines.join('\n');change();};label.append(check,n('span',null,checklist[2]));preview.append(label);}else{const heading=/^#{1,3} /.test(line),row=n(heading?'h2':'p');const text=line.replace(/^#{1,3} /,'');text.split(/(\*\*.*?\*\*)/g).forEach(part=>{row.append(part.startsWith('**')&&part.endsWith('**')?n('strong',null,part.slice(2,-2)):document.createTextNode(part));});preview.append(row);}});}
  const previewButton=b('Preview',()=>{preview.hidden=!preview.hidden;ta.hidden=!preview.hidden;previewButton.textContent=preview.hidden?'Preview':'Edit';if(!preview.hidden)renderPreview();});formatting.append(previewButton);
  const stamp=n('div','note-stamp');editor.append(enav,formatting,help,ta,preview,stamp);root.append(editor);
  function change(){r.text=ta.value;r.updatedAt=Date.now();dirty=true;version++;state.textContent='Unsaved';stamp.textContent='Edited '+new Date(r.updatedAt).toLocaleString();clearTimeout(timer);timer=setTimeout(save,350);}
  function save(){clearTimeout(timer);if(deleted||!dirty)return chain;const snapshot={...r},v=version;chain=chain.then(async()=>{if(deleted||v<=savedVersion)return;const result=await DB.put('notes',snapshot);if(!result){state.textContent='Not saved — retry';throw new Error('Could not save note. Check device storage.');}savedVersion=v;if(v===version){dirty=false;state.textContent='Saved';}}).catch(e=>{state.textContent='Save failed — tap to retry';api.toast(e.message);});return chain;}
  flush=save;canLeave=async()=>{await save();return !dirty||deleted||confirm('The note could not be saved. Leave without saving these changes?');};state.tabIndex=0;state.onclick=save;ta.oninput=change;ta.onblur=save;
  async function close(){await save();if(dirty&&!deleted){if(!confirm('This note could not be saved. Leave the editor anyway?'))return;}if(editor){editor.remove();editor=null;}flush=null;canLeave=null;draw();}
  async function remove(){if(!confirm('Delete this note? Synced notes move to cloud Trash after syncing.'))return;clearTimeout(timer);deleted=true;await chain;const ok=await DB.del('notes',r.id);if(ok===false){deleted=false;api.toast('Could not delete note. Check device storage.');return;}notes=notes.filter(x=>x.id!==r.id);dirty=false;flush=null;editor.remove();editor=null;draw();}
  stamp.textContent='Edited '+new Date(r.updatedAt).toLocaleString();if(isNew){ta.focus();save();}
 }
 function persist(){if(flush)flush();}document.addEventListener('visibilitychange',persist);window.addEventListener('pagehide',persist);
 DB.all('notes').then(a=>{const existing=new Set(notes.map(r=>r.id));notes=notes.concat((a||[]).filter(r=>!existing.has(r.id)));draw();});
 const cleanup=()=>{persist();dead=true;clearTimeout(searchTimer);document.removeEventListener('visibilitychange',persist);window.removeEventListener('pagehide',persist);};cleanup.beforeClose=()=>canLeave?canLeave():Promise.resolve(true);return cleanup;
}
global.LoftNotes={mount};
})(window);
