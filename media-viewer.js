/* Three retained pages give gestures real neighbouring media, not a source swap. */
(function(global){
'use strict';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
function open({parent,items,id,get,download,toast=()=>{},onClose=()=>{}}){
 let index=items.findIndex(x=>x.id===id),closed=false,animating=false,dragX=0,dragY=0,axis=null,start=null,scale=1,panX=0,panY=0,pinch=null;
 if(index<0)return()=>{};
 const reduced=global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches,duration=reduced?0:240;
 const v=el('div','media-viewer viewer'),top=el('header','viewer-nav'),title=el('div','viewer-title'),area=el('div','media-stage paged-stage'),footer=el('footer','viewer-actions'),pages=new Map(),pointers=new Map();
 v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-label','Media viewer');title.setAttribute('aria-live','polite');
 const btn=(text,fn)=>{const b=el('button',null,text);b.type='button';b.onclick=fn;return b;};
 const back=btn('Done',close),save=btn('Download',()=>{const r=current()?.record;if(r)download(r.blob,r.name);});top.append(back,title,save);
 const prev=btn('‹ Previous',()=>navigate(index-1)),next=btn('Next ›',()=>navigate(index+1)),zoom=btn('Zoom',()=>{scale=scale===1?2:1;panX=panY=0;paint();}),share=btn('Share',async()=>{const r=current()?.record;if(!r)return;const f=new File([r.blob],r.name,{type:r.type});try{if(navigator.canShare?.({files:[f]}))await navigator.share({files:[f]});else download(r.blob,r.name);}catch(e){if(e.name!=='AbortError')toast('Sharing unavailable. Use Download.');}});
 footer.append(prev,zoom,share,next);v.append(top,area,footer);parent.append(v);back.focus();
 function current(){return pages.get(index);}
 function dispose(p){p.dead=true;if(p.media?.tagName==='VIDEO'){p.media.pause();p.media.removeAttribute('src');p.media.load();}if(p.url)URL.revokeObjectURL(p.url);p.el.remove();}
 function load(i){
  if(i<0||i>=items.length)return null;if(pages.has(i))return pages.get(i);
  const p={el:el('div','media-page'),record:null,media:null,url:null,dead:false};p.el.append(el('p',null,'Opening original…'));pages.set(i,p);area.append(p.el);
  p.ready=(async()=>{try{const r=await get(items[i]);if(closed||p.dead)return;if(!r?.blob)throw new Error('This original is unavailable.');p.record=r;p.url=URL.createObjectURL(r.blob);const m=el(r.kind==='video'?'video':'img');p.media=m;
   if(r.kind==='video'){m.controls=true;m.playsInline=true;m.preload=i===index?'metadata':'none';if(r.thumb instanceof Blob){p.poster=URL.createObjectURL(r.thumb);m.poster=p.poster;}}
   else{m.alt=r.name||'';m.draggable=false;m.decoding='async';}
   m.onerror=()=>{if(!p.dead){p.el.textContent='';p.el.append(el('p',null,'This browser cannot preview this format. Use Download to open the original.'));}};
   m.src=p.url;p.el.replaceChildren(m);if(i===index)update();if(!animating)paint();
  }catch(e){if(!closed&&!p.dead){p.el.textContent='';p.el.append(el('p',null,e.message));}}})();return p;
 }
 function update(){title.textContent=items[index].name+' · '+(index+1)+' / '+items.length;prev.disabled=index===0;next.disabled=index===items.length-1;save.disabled=share.disabled=!current()?.record;zoom.hidden=items[index].kind==='video';zoom.textContent=scale===1?'Zoom':'Reset zoom';}
 function paint(transition=false){const w=area.clientWidth||innerWidth;for(const [i,p] of pages){p.el.style.transition=transition?'transform '+duration+'ms cubic-bezier(.22,.7,.2,1)':'none';p.el.style.transform='translate3d('+((i-index)*w+dragX)+'px,'+dragY+'px,0) scale('+(1-Math.min(dragY/(area.clientHeight||600),.65)*.2)+')';p.el.setAttribute('aria-hidden',String(i!==index));if(p.media){p.media.tabIndex=i===index?0:-1;if(p.media.tagName==='IMG')p.media.style.transform=i===index?'translate('+panX+'px,'+panY+'px) scale('+scale+')':'';}}
  v.style.background='rgba(8,9,11,'+(1-Math.min(dragY/(area.clientHeight||600),.85))+')';top.style.opacity=footer.style.opacity=String(1-Math.min(dragY/220,.9));zoom.textContent=scale===1?'Zoom':'Reset zoom';
 }
 function fill(){load(index);load(index-1);load(index+1);for(const [i,p] of pages){if(Math.abs(i-index)>1){if(p.poster)URL.revokeObjectURL(p.poster);dispose(p);pages.delete(i);}}update();paint();}
 async function settle(){paint(true);await new Promise(r=>setTimeout(r,duration));if(!closed)paint();}
 async function navigate(i){if(closed||animating)return;if(i<0||i>=items.length){dragX=dragY=0;return settle();}if(i===index)return;
  animating=true;const p=load(i);paint();await p.ready;if(closed)return;const old=current();if(old?.media?.pause)old.media.pause();dragX=(index-i)*(area.clientWidth||innerWidth);dragY=0;scale=1;panX=panY=0;await settle();if(closed)return;index=i;dragX=0;animating=false;fill();if(current()?.media?.tagName==='VIDEO')current().media.preload='metadata';
 }
 function reset(){pointers.clear();start=null;pinch=null;axis=null;dragX=dragY=0;paint(true);}
 area.onpointerdown=e=>{
  if(animating||e.button>0)return;
  // Leave native play/seek/full-screen controls usable.
  if(e.target.tagName==='VIDEO'){const rect=e.target.getBoundingClientRect();if(e.clientY>rect.bottom-54)return;}
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2&&items[index].kind!=='video'){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),scale};dragX=dragY=0;axis='pinch';}
  else if(pointers.size===1)start={x:e.clientX,y:e.clientY,time:performance.now(),panX,panY};
 };
 area.onpointermove=e=>{
  if(!pointers.has(e.pointerId)||animating)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()];scale=Math.max(1,Math.min(5,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(pinch.distance,1)));paint();return;}
  if(!start||pointers.size!==1||axis==='pinch')return;const x=e.clientX-start.x,y=e.clientY-start.y;
  if(scale>1){panX=start.panX+x;panY=start.panY+y;paint();return;}
  if(!axis&&Math.hypot(x,y)>8){axis=Math.abs(x)>Math.abs(y)?'horizontal':'vertical';if(area.setPointerCapture)area.setPointerCapture(e.pointerId);}
  if(axis==='horizontal'){dragX=x;if((index===0&&x>0)||(index===items.length-1&&x<0))dragX=x*.23;}
  if(axis==='vertical')dragY=Math.max(0,y);paint();
 };
 area.onpointerup=e=>{
  pointers.delete(e.pointerId);if(pointers.size)return;
  const elapsed=start?Math.max(1,performance.now()-start.time):1000,x=dragX,y=dragY;start=null;pinch=null;
  if(axis==='horizontal'&&scale===1){const target=index+(x<0?1:-1);axis=null;if(Math.abs(x)>Math.min(110,(area.clientWidth||360)*.24)||(Math.abs(x)>24&&Math.abs(x)/elapsed>.45)){navigate(target);return;}}
  if(axis==='vertical'&&scale===1&&(y>Math.min(150,(area.clientHeight||600)*.23)||(y>40&&y/elapsed>.55))){animating=true;dragY=area.clientHeight||innerHeight;settle().then(close);return;}
  reset();
 };
 area.onpointercancel=reset;area.onlostpointercapture=e=>{if(e.target===area&&pointers.has(e.pointerId))reset();};area.ondblclick=()=>{if(items[index].kind!=='video'){scale=scale===1?2:1;panX=panY=0;paint();}};
 function keys(e){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}if(e.key==='ArrowLeft'){e.preventDefault();navigate(index-1);}if(e.key==='ArrowRight'){e.preventDefault();navigate(index+1);}if(e.key==='Tab'){const controls=[...v.querySelectorAll('button:not(:disabled)')].filter(x=>!x.hidden),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}
 function close(){if(closed)return;closed=true;for(const p of pages.values()){if(p.poster)URL.revokeObjectURL(p.poster);dispose(p);}pages.clear();document.removeEventListener('keydown',keys,true);global.removeEventListener('resize',resize);v.remove();onClose();}
 function resize(){dragX=dragY=0;paint();}
 global.addEventListener('resize',resize);document.addEventListener('keydown',keys,true);v.addEventListener('closeviewer',close);fill();return close;
}
global.LoftViewer={open};
})(window);
