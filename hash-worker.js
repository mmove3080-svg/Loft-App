importScripts('sha256.js');
onmessage=async({data})=>{try{const h=new LoftSHA256();for(let i=0;i<data.blob.size;i+=1048576)h.update(new Uint8Array(await data.blob.slice(i,i+1048576).arrayBuffer()));postMessage({id:data.id,hash:Array.from(h.digest(),n=>n.toString(16).padStart(2,'0')).join('')});}catch(e){postMessage({id:data.id,error:e.message});}};
