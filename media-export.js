/* Store-only ZIP: no recompression, original bytes and names retained. */
(function(g){'use strict';
const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}
async function crc(blob,cancel){let c=0xffffffff;for(let i=0;i<blob.size;i+=262144){if(cancel())throw new Error('Export cancelled. Originals were not changed.');const a=new Uint8Array(await blob.slice(i,i+262144).arrayBuffer());for(const b of a)c=table[(c^b)&255]^(c>>>8);await new Promise(r=>setTimeout(r,0));}return (c^0xffffffff)>>>0;}
function header(length){const b=new Uint8Array(length),v=new DataView(b.buffer);return {b,u16:(o,x)=>v.setUint16(o,x,true),u32:(o,x)=>v.setUint32(o,x,true)};}
async function zip(store,ids,progress=()=>{},cancel=()=>false){
 const meta=await store.scan(),wanted=new Set(ids),total=meta.reduce((n,r)=>n+(wanted.has(r.id)?r.size:0),0);
 if(total>512*1024*1024||ids.length>65535)throw new Error('This browser’s ZIP export is limited to 512 MiB per batch. Select fewer files, or use a desktop browser with folder export for larger batches.');
 const body=[],directory=[];let offset=0,dirBytes=0;
 for(let i=0;i<ids.length;i++){
  if(cancel())throw new Error('Export cancelled. Originals were not changed.');
  const r=await store.get(ids[i]);if(!r||!r.blob)throw new Error('An item is no longer available. Refresh the library and retry.');
  if(offset+r.blob.size>512*1024*1024)throw new Error('Export exceeds the 512 MiB ZIP limit. Choose a smaller batch.');
  const safe=(r.name||'original').split(/[\\/]/).pop(),name=new TextEncoder().encode(String(i+1).padStart(5,'0')+'/'+safe),checksum=await crc(r.blob,cancel),d=new Date(r.lastModified||r.createdAt||Date.now());
  const time=(d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1),date=((Math.max(1980,Math.min(2107,d.getFullYear()))-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate();
  const h=header(30);h.u32(0,0x04034b50);h.u16(4,20);h.u16(6,0x800);h.u16(10,time);h.u16(12,date);h.u32(14,checksum);h.u32(18,r.blob.size);h.u32(22,r.blob.size);h.u16(26,name.length);body.push(h.b,name,r.blob);
  const c=header(46);c.u32(0,0x02014b50);c.u16(4,20);c.u16(6,20);c.u16(8,0x800);c.u16(12,time);c.u16(14,date);c.u32(16,checksum);c.u32(20,r.blob.size);c.u32(24,r.blob.size);c.u16(28,name.length);c.u32(42,offset);directory.push(c.b,name);dirBytes+=46+name.length;offset+=30+name.length+r.blob.size;progress(i+1,ids.length);
 }
 const end=header(22);end.u32(0,0x06054b50);end.u16(8,ids.length);end.u16(10,ids.length);end.u32(12,dirBytes);end.u32(16,offset);return new Blob([...body,...directory,end.b],{type:'application/zip'});
}
async function folder(handle,store,ids,progress=()=>{},cancel=()=>false){const out=await handle.getDirectoryHandle('Loft originals '+Date.now(),{create:true});for(let i=0;i<ids.length;i++){if(cancel())throw new Error('Export stopped. Completed files remain in the selected folder.');const r=await store.get(ids[i]);if(!r||!r.blob)throw new Error('An original was removed. Completed exports remain in the folder.');const dir=await out.getDirectoryHandle(String(i+1).padStart(5,'0'),{create:true}),name=(r.name||'original').replace(/[\\/:*?"<>|]/g,'_'),file=await dir.getFileHandle(name,{create:true}),writer=await file.createWritable();try{const reader=r.blob.stream().getReader();for(;;){if(cancel()){await reader.cancel();throw new Error('Export stopped. Completed files remain in the selected folder.');}const chunk=await reader.read();if(chunk.done)break;await writer.write(chunk.value);}await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}progress(i+1,ids.length);}}
g.LoftExport={zip,folder};if(typeof module!=='undefined')module.exports=g.LoftExport;
})(globalThis);
