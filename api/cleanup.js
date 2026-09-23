'use strict';
const {timingSafeEqual}=require('node:crypto');
const {storage}=require('../lib/storage');
const {syncIndex}=require('../lib/sync');
function authorized(header,secret){
 if(typeof secret!=='string'||secret.length<32||typeof header!=='string')return false;
 const a=Buffer.from(header),b=Buffer.from('Bearer '+secret);
 return a.length===b.length&&timingSafeEqual(a,b);
}
async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('Vercel-CDN-Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
 if(!authorized(req.headers.authorization,process.env.CRON_SECRET))return res.status(401).json({error:'Unauthorized.'});
 const uid=process.env.APP_OWNER_USER_ID;
 if(!/^[a-f0-9-]{36}$/i.test(uid||''))return res.status(503).json({error:'Owner is not configured.'});
 try{
  const options={...storage(),prefix:'loft-private/v1/'+uid+'/',method:'POST'};
  const result=await syncIndex({...options,operation:'expire'});
  let done=false,batches=0;const deadline=Date.now()+20000;
  while(!done&&batches<20&&Date.now()<deadline){done=(await syncIndex({...options,cleanup:true})).done;batches++;}
  console.info('Trash cleanup',JSON.stringify({expired:result.expired,batches,done}));
  return res.status(200).json({expired:result.expired,batches,done});
 }catch(e){
  // A conditional-write conflict is safe: the next daily run resumes.
  console.error('Trash cleanup failed',e.name||'Error');
  return res.status(e.$metadata?.httpStatusCode===412?409:503).json({error:'Cleanup incomplete. Next scheduled run will retry.'});
 }
}
module.exports=handler;
module.exports.authorized=authorized;
