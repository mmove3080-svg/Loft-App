/* Incremental large-file hashing avoids allocating the entire original in RAM. */
(function(g){let worker,serial=0,disabled=false;const pending=new Map();
 async function fallback(blob){const h=new g.LoftSHA256();for(let i=0;i<blob.size;i+=262144){h.update(new Uint8Array(await blob.slice(i,i+262144).arrayBuffer()));await new Promise(r=>setTimeout(r,0));}return Array.from(h.digest(),x=>x.toString(16).padStart(2,'0')).join('');}
 async function hash(blob){if(blob.size<=1048576)return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
  if(disabled||!g.Worker)return fallback(blob);
  try{if(!worker){worker=new Worker('hash-worker.js');worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;clearTimeout(task.timer);pending.delete(data.id);data.error?task.reject(new Error(data.error)):task.resolve(data.hash);};worker.onerror=()=>{disabled=true;worker.terminate();worker=null;for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Worker unavailable'));}pending.clear();};}
   return await new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Hashing timed out'));},300000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,blob});});
  }catch(e){disabled=true;return fallback(blob);}
 }
 g.LoftHash=hash;
})(globalThis);
